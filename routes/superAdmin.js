const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Company = require('../models/Company');
const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/authMiddleware');

// ✅ Apply super admin middleware to all routes
router.use(protect);
router.use(restrictTo('super_admin')); // Only super_admin can access these routes

// Super Admin Login (Public route - no middleware)
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    console.log('Super Admin login attempt for:', email);
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Find user with Management department AND super_admin jobRole
    const user = await User.findOne({ 
      email: email.toLowerCase().trim(),
      department: "Management",
      jobRole: "super_admin"
    }).select('+password');
    
    if (!user) {
      console.log('Super admin not found:', email);
      return res.status(401).json({
        success: false,
        message: 'Access denied. Super admin privileges required.'
      });
    }
    
    console.log('Super admin found:', user.name, user.department, user.jobRole);
    
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account is deactivated'
      });
    }
    
    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: 'Account not verified'
      });
    }
    
    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }
    
    // Create JWT token
    const token = jwt.sign(
      { 
        id: user._id,
        email: user.email,
        role: 'super-admin',
        company: user.company,
        department: user.department,
        jobRole: user.jobRole
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );
    
    // Update last login
    user.lastLogin = new Date();
    await user.save();
    
    res.json({
      success: true,
      message: 'Super Admin login successful',
      token,
      data: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: 'super-admin',
        company: user.company,
        companyRole: user.companyRole,
        department: user.department,
        jobRole: user.jobRole,
        employeeId: user.employeeId,
        companyCode: user.companyCode
      }
    });
    
  } catch (error) {
    console.error('Super admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ✅ Get Dashboard Stats
router.get('/stats', async (req, res) => {
  try {
    const totalCompanies = await Company.countDocuments();
    const activeCompanies = await Company.countDocuments({ isActive: true });
    const totalUsers = await User.countDocuments();
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogins = await User.countDocuments({
      lastLogin: { $gte: today }
    });
    
    res.json({
      totalCompanies,
      activeCompanies,
      totalUsers,
      todayLogins
    });
    
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ✅ Get all companies (for dashboard)
router.get('/companies', async (req, res) => {
  try {
    const companies = await Company.find()
      .sort({ createdAt: -1 });
    
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch companies' });
  }
});

// ✅ Get all users (for dashboard)
router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .populate('company', 'companyName')
      .sort({ createdAt: -1 });
    
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ==================== ALLCOMPANY PAGE APIS ====================

// ✅ GET ALL COMPANIES WITH USER COUNTS (For AllCompany page)
router.get('/companies-with-users', async (req, res) => {
  try {
    console.log('📊 Fetching all companies with user counts...');
    
    const companies = await Company.find()
      .sort({ createdAt: -1 })
      .lean();
    
    console.log(`✅ Found ${companies.length} companies`);
    
    // Add user counts to each company
    const companiesWithUsers = await Promise.all(
      companies.map(async (company) => {
        try {
          const userCount = await User.countDocuments({ 
            company: company._id 
          });
          
          const sampleUsers = await User.find({ 
            company: company._id 
          })
            .select('name email role employeeId isActive')
            .limit(3)
            .lean();
          
          return {
            ...company,
            userCount,
            users: sampleUsers
          };
        } catch (err) {
          console.error(`Error fetching users for company ${company._id}:`, err);
          return {
            ...company,
            userCount: 0,
            users: []
          };
        }
      })
    );
    
    console.log(`✅ Successfully fetched ${companiesWithUsers.length} companies with user data`);
    res.json(companiesWithUsers);
    
  } catch (error) {
    console.error("❌ Error fetching companies with users:", error);
    res.status(500).json({ 
      error: "Failed to fetch companies", 
      message: error.message 
    });
  }
});

// ✅ GET USERS OF SPECIFIC COMPANY
router.get('/company/:companyId/users', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    console.log(`📊 Fetching users for company: ${companyId}`);
    
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }
    
    const users = await User.find({ company: companyId })
      .select('name email role employeeId isActive lastLogin department jobRole')
      .sort({ name: 1 })
      .lean();
    
    console.log(`✅ Found ${users.length} users for company ${company.companyName}`);
    res.json(users);
    
  } catch (error) {
    console.error("❌ Error fetching company users:", error);
    res.status(500).json({ 
      error: "Failed to fetch users", 
      message: error.message 
    });
  }
});

// ✅ GET COMPANY DETAILS WITH COMPLETE INFO
router.get('/company/:companyId/details', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    console.log(`📊 Fetching complete details for company: ${companyId}`);
    
    const company = await Company.findById(companyId)
      .populate('ownerId', 'name email')
      .lean();
    
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }
    
    const userCount = await User.countDocuments({ company: companyId });
    const activeUserCount = await User.countDocuments({ 
      company: companyId,
      isActive: true 
    });
    
    const recentUsers = await User.find({ company: companyId })
      .select('name email role employeeId isActive lastLogin')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();
    
    const companyDetails = {
      ...company,
      userCount,
      activeUserCount,
      recentUsers,
      stats: {
        totalUsers: userCount,
        activeUsers: activeUserCount,
        inactiveUsers: userCount - activeUserCount
      }
    };
    
    console.log(`✅ Company details fetched successfully for ${company.companyName}`);
    res.json(companyDetails);
    
  } catch (error) {
    console.error("❌ Error fetching company details:", error);
    res.status(500).json({ 
      error: "Failed to fetch company details", 
      message: error.message 
    });
  }
});

// ✅ GET COMPANY STATISTICS
router.get('/companies-stats', async (req, res) => {
  try {
    console.log("📊 Fetching companies statistics...");
    
    const totalCompanies = await Company.countDocuments();
    const activeCompanies = await Company.countDocuments({ isActive: true });
    
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentCompanies = await Company.countDocuments({
      createdAt: { $gte: thirtyDaysAgo }
    });
    
    const companiesByStatus = await Company.aggregate([
      {
        $group: {
          _id: "$isActive",
          count: { $sum: 1 }
        }
      }
    ]);
    
    const companies = await Company.find()
      .select('companyName companyCode companyEmail isActive createdAt')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    
    const companiesWithCounts = await Promise.all(
      companies.map(async (company) => {
        const userCount = await User.countDocuments({ company: company._id });
        return {
          ...company,
          userCount
        };
      })
    );
    
    const stats = {
      totalCompanies,
      activeCompanies,
      inactiveCompanies: totalCompanies - activeCompanies,
      recentCompanies,
      companiesByStatus: {
        active: companiesByStatus.find(s => s._id === true)?.count || 0,
        inactive: companiesByStatus.find(s => s._id === false)?.count || 0
      },
      recentCompaniesList: companiesWithCounts
    };
    
    console.log(`✅ Companies stats fetched: 
      Total: ${totalCompanies}, 
      Active: ${activeCompanies}`);
    res.json(stats);
    
  } catch (error) {
    console.error("❌ Error fetching companies stats:", error);
    res.status(500).json({ 
      error: "Failed to fetch statistics", 
      message: error.message 
    });
  }
});

// ✅ SEARCH COMPANIES
router.get('/search-companies', async (req, res) => {
  try {
    const { query, status, page = 1, limit = 20 } = req.query;
    
    console.log(`🔍 Searching companies with query: ${query || 'none'}`);
    
    const filter = {};
    
    if (query) {
      filter.$or = [
        { companyName: { $regex: query, $options: 'i' } },
        { companyEmail: { $regex: query, $options: 'i' } },
        { companyCode: { $regex: query, $options: 'i' } },
        { ownerName: { $regex: query, $options: 'i' } }
      ];
    }
    
    if (status === 'active') {
      filter.isActive = true;
    } else if (status === 'inactive') {
      filter.isActive = false;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Company.countDocuments(filter);
    
    const companies = await Company.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();
    
    const companiesWithUsers = await Promise.all(
      companies.map(async (company) => {
        const userCount = await User.countDocuments({ company: company._id });
        return {
          ...company,
          userCount
        };
      })
    );
    
    const response = {
      companies: companiesWithUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      },
      searchInfo: {
        query: query || '',
        status: status || 'all',
        results: companiesWithUsers.length
      }
    };
    
    console.log(`✅ Search completed: ${companiesWithUsers.length} companies found`);
    res.json(response);
    
  } catch (error) {
    console.error("❌ Error searching companies:", error);
    res.status(500).json({ 
      error: "Failed to search companies", 
      message: error.message 
    });
  }
});

// ✅ GET COMPANY SUMMARY (Quick stats)
router.get('/company/:companyId/summary', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: "Company not found" });
    }
    
    // Get user counts by role
    const usersByRole = await User.aggregate([
      { $match: { company: company._id } },
      { $group: { _id: "$role", count: { $sum: 1 } } }
    ]);
    
    // Get active/inactive users
    const activeUsers = await User.countDocuments({ 
      company: companyId,
      isActive: true 
    });
    
    const totalUsers = await User.countDocuments({ company: companyId });
    
    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentLogins = await User.countDocuments({
      company: companyId,
      lastLogin: { $gte: sevenDaysAgo }
    });
    
    res.json({
      companyId: company._id,
      companyName: company.companyName,
      companyCode: company.companyCode,
      totalUsers,
      activeUsers,
      inactiveUsers: totalUsers - activeUsers,
      usersByRole: usersByRole.reduce((acc, curr) => {
        acc[curr._id] = curr.count;
        return acc;
      }, {}),
      recentActivity: {
        recentLogins,
        last7Days: sevenDaysAgo.toLocaleDateString()
      },
      status: company.isActive ? 'Active' : 'Inactive',
      createdDate: company.createdAt
    });
    
  } catch (error) {
    console.error("Error fetching company summary:", error);
    res.status(500).json({ error: "Failed to fetch company summary" });
  }
});

// ✅ EXPORT COMPANIES DATA (CSV)
router.get('/export-companies', async (req, res) => {
  try {
    console.log("📤 Exporting companies data...");
    
    const companies = await Company.find().lean();
    
    const companiesWithUsers = await Promise.all(
      companies.map(async (company) => {
        const userCount = await User.countDocuments({ company: company._id });
        return {
          ...company,
          userCount
        };
      })
    );
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=companies_export_${Date.now()}.csv`);
    
    // Create CSV content
    const csvHeader = [
      'Company Code',
      'Company Name',
      'Email',
      'Phone',
      'Address',
      'Owner Name',
      'Owner Email',
      'Status',
      'Total Users',
      'Created Date'
    ].join(',');
    
    const csvRows = companiesWithUsers.map(company => [
      company.companyCode || '',
      `"${company.companyName || ''}"`,
      company.companyEmail || '',
      company.companyPhone || '',
      `"${company.companyAddress || ''}"`,
      `"${company.ownerName || ''}"`,
      company.ownerEmail || '',
      company.isActive ? 'Active' : 'Inactive',
      company.userCount || 0,
      new Date(company.createdAt).toLocaleDateString()
    ].join(','));
    
    const csvContent = [csvHeader, ...csvRows].join('\n');
    
    res.send(csvContent);
    
  } catch (error) {
    console.error("❌ Error exporting companies:", error);
    res.status(500).json({ error: "Failed to export companies data" });
  }
});

// ✅ Deactivate company
router.patch('/company/:id/deactivate', async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: 'Company deactivated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate company' });
  }
});

// ✅ Activate company
router.patch('/company/:id/activate', async (req, res) => {
  try {
    await Company.findByIdAndUpdate(req.params.id, { isActive: true });
    res.json({ message: 'Company activated' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate company' });
  }
});

// ✅ Delete company
router.delete('/company/:id', async (req, res) => {
  try {
    await Company.findByIdAndDelete(req.params.id);
    res.json({ message: 'Company deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete company' });
  }
});

module.exports = router;