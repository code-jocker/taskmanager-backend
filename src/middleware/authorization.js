export const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    if (req.userType === 'district_admin') {
      if (allowedRoles.includes('district_admin')) {
        return next();
      }
    } else if (req.user) {
      if (allowedRoles.includes(req.user.role)) {
        return next();
      }
    }
    
    return res.status(403).json({
      success: false,
      message: 'Access denied. Insufficient permissions.'
    });
  };
};

export const districtScopeMiddleware = async (req, res, next) => {
  try {
    if (req.userType !== 'district_admin') {
      return res.status(403).json({
        success: false,
        message: 'District admin access required.'
      });
    }
    
    // Add district scope to queries
    req.districtScope = {
      district_id: req.admin.district_id
    };
    
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error applying district scope.'
    });
  }
};

export const organizationScopeMiddleware = async (req, res, next) => {
  try {
    if (req.userType === 'district_admin') {
      // District admins can access all organizations in their district
      req.organizationScope = {
        district_id: req.admin.district_id
      };
    } else if (req.user) {
      // Regular users can only access their organization
      req.organizationScope = {
        organization_id: req.user.organization_id
      };
    } else {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }
    
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error applying organization scope.'
    });
  }
};

export const ownershipMiddleware = (resourceModel, resourceIdParam = 'id') => {
  return async (req, res, next) => {
    try {
      const resourceId = req.params[resourceIdParam];
      const resource = await resourceModel.findByPk(resourceId);
      
      if (!resource) {
        return res.status(404).json({
          success: false,
          message: 'Resource not found.'
        });
      }
      
      // Check ownership based on user type
      if (req.userType === 'district_admin') {
        // District admins can access resources in their district
        if (resource.district_id && resource.district_id !== req.admin.district_id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. Resource not in your district.'
          });
        }
      } else if (req.user) {
        // Regular users can only access resources in their organization
        if (resource.organization_id && resource.organization_id !== req.user.organization_id) {
          return res.status(403).json({
            success: false,
            message: 'Access denied. Resource not in your organization.'
          });
        }
        
        // Additional checks for specific roles
        if (resource.created_by && resource.created_by !== req.user.id) {
          const allowedRoles = ['organization_admin', 'teacher'];
          if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
              success: false,
              message: 'Access denied. You can only access your own resources.'
            });
          }
        }
      }
      
      req.resource = resource;
      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error checking resource ownership.'
      });
    }
  };
};