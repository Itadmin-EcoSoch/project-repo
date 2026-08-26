/**
 * Validation Schemas - Users & Launcher Tables
 * Joi-based validation for complete data integrity
 */

const Joi = require('joi');

// ═════════════════════════════════════════════════════════════════════════
// ENUM DEFINITIONS
// ═════════════════════════════════════════════════════════════════════════

const roleEnum = Joi.string().valid('admin', 'manager', 'supervisor', 'staff', 'viewer');
const departmentEnum = Joi.string().valid('operations', 'sales', 'technical', 'finance', 'hr', 'admin', 'marketing', 'other');
const userStatusEnum = Joi.string().valid('active', 'inactive', 'on_leave', 'terminated');
const launcherStatusEnum = Joi.string().valid('active', 'inactive', 'hidden');
const iconNameEnum = Joi.string().valid(
  'dashboard', 'projects', 'clients', 'users', 'reports', 'settings',
  'calendar', 'messages', 'files', 'analytics', 'inventory', 'billing', 'help', 'logout', 'profile'
);
const iconStyleEnum = Joi.string().valid('outlined', 'filled', 'rounded', 'sharp');

// ═════════════════════════════════════════════════════════════════════════
// USERS TABLE SCHEMAS
// ═════════════════════════════════════════════════════════════════════════

const createUserSchema = Joi.object({
  userId: Joi.string().uuid().required(),
  firstName: Joi.string().min(2).max(100).required(),
  lastName: Joi.string().min(2).max(100).required(),
  email: Joi.string().email().required(),
  phone: Joi.string().optional().allow(null),
  username: Joi.string().alphanum().min(3).max(50).required(),
  role: roleEnum.required(),
  department: departmentEnum.required(),
  status: userStatusEnum.default('active'),
  profilePicture: Joi.string().uri().optional().allow(null),
  bio: Joi.string().max(500).optional().allow(null),
  startDate: Joi.date().required(),
  endDate: Joi.date().optional().allow(null),
  managerId: Joi.string().uuid().optional().allow(null),
  permissionsLevel: Joi.number().integer().min(1).max(5).required(),
  twoFactorEnabled: Joi.boolean().default(false),
  createdAt: Joi.date().optional(),
  updatedAt: Joi.date().optional()
});

const updateUserSchema = Joi.object({
  firstName: Joi.string().min(2).max(100).optional(),
  lastName: Joi.string().min(2).max(100).optional(),
  email: Joi.string().email().optional(),
  phone: Joi.string().optional().allow(null),
  username: Joi.string().alphanum().min(3).max(50).optional(),
  role: roleEnum.optional(),
  department: departmentEnum.optional(),
  status: userStatusEnum.optional(),
  profilePicture: Joi.string().uri().optional().allow(null),
  bio: Joi.string().max(500).optional().allow(null),
  startDate: Joi.date().optional(),
  endDate: Joi.date().optional().allow(null),
  managerId: Joi.string().uuid().optional().allow(null),
  permissionsLevel: Joi.number().integer().min(1).max(5).optional(),
  twoFactorEnabled: Joi.boolean().optional(),
  lastLogin: Joi.date().optional(),
  updatedAt: Joi.date().optional()
});

// ═════════════════════════════════════════════════════════════════════════
// LAUNCHER TABLE SCHEMAS
// ═════════════════════════════════════════════════════════════════════════

const createLauncherSchema = Joi.object({
  launcherId: Joi.string().uuid().required(),
  title: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).optional().allow(null),
  iconName: iconNameEnum.required(),
  iconURL: Joi.string().uri().optional().allow(null),
  targetApp: Joi.string().max(255).optional().allow(null),
  targetView: Joi.string().max(255).optional().allow(null),
  externalURL: Joi.string().uri().optional().allow(null),
  orderIndex: Joi.number().integer().min(1).max(999).required(),
  status: launcherStatusEnum.default('active'),
  roleRestrictions: Joi.array().items(roleEnum).optional(),
  departmentRestrictions: Joi.array().items(departmentEnum).optional(),
  color: Joi.string().regex(/^#[0-9A-F]{6}$/i).default('#2196F3').optional(),
  iconStyle: iconStyleEnum.default('filled').optional(),
  badgeCount: Joi.number().integer().min(0).optional(),
  isFeatured: Joi.boolean().default(false).optional(),
  helpText: Joi.string().max(500).optional().allow(null),
  createdBy: Joi.string().uuid().optional(),
  createdAt: Joi.date().optional(),
  updatedAt: Joi.date().optional()
});

const updateLauncherSchema = Joi.object({
  title: Joi.string().min(2).max(100).optional(),
  description: Joi.string().max(500).optional().allow(null),
  iconName: iconNameEnum.optional(),
  iconURL: Joi.string().uri().optional().allow(null),
  targetApp: Joi.string().max(255).optional().allow(null),
  targetView: Joi.string().max(255).optional().allow(null),
  externalURL: Joi.string().uri().optional().allow(null),
  orderIndex: Joi.number().integer().min(1).max(999).optional(),
  status: launcherStatusEnum.optional(),
  roleRestrictions: Joi.array().items(roleEnum).optional(),
  departmentRestrictions: Joi.array().items(departmentEnum).optional(),
  color: Joi.string().regex(/^#[0-9A-F]{6}$/i).optional(),
  iconStyle: iconStyleEnum.optional(),
  badgeCount: Joi.number().integer().min(0).optional(),
  isFeatured: Joi.boolean().optional(),
  helpText: Joi.string().max(500).optional().allow(null),
  updatedAt: Joi.date().optional()
});

// ═════════════════════════════════════════════════════════════════════════
// VALIDATION FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════

/**
 * Validate user on create
 */
function validateCreateUser(data) {
  return createUserSchema.validate(data, {
    abortEarly: false,
    convert: true,
    stripUnknown: true
  });
}

/**
 * Validate user on update
 */
function validateUpdateUser(data) {
  return updateUserSchema.validate(data, {
    abortEarly: false,
    convert: true,
    stripUnknown: true
  });
}

/**
 * Validate launcher on create
 */
function validateCreateLauncher(data) {
  // Additional custom validation
  const { error, value } = createLauncherSchema.validate(data, {
    abortEarly: false,
    convert: true,
    stripUnknown: true
  });

  if (error) return { error };

  // Must have at least one target
  if (!value.targetApp && !value.externalURL) {
    return {
      error: {
        details: [{
          message: 'Launcher must have either targetApp or externalURL'
        }]
      }
    };
  }

  return { value };
}

/**
 * Validate launcher on update
 */
function validateUpdateLauncher(data) {
  return updateLauncherSchema.validate(data, {
    abortEarly: false,
    convert: true,
    stripUnknown: true
  });
}

/**
 * Validate user permissions
 */
function validateUserPermissions(userData) {
  const errors = {};

  // Role and permission level consistency
  const roleLevels = {
    admin: 5,
    manager: 4,
    supervisor: 3,
    staff: 2,
    viewer: 1
  };

  if (userData.role && userData.permissionsLevel) {
    const expectedLevel = roleLevels[userData.role];
    if (userData.permissionsLevel !== expectedLevel) {
      errors.permissionsLevel = `Permissions level for ${userData.role} should be ${expectedLevel}`;
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Validate launcher visibility rules
 */
function validateLauncherVisibility(launcherData) {
  const errors = {};

  // Cannot be both hidden and featured
  if (launcherData.status === 'hidden' && launcherData.isFeatured) {
    errors.isFeatured = 'Hidden launchers cannot be featured';
  }

  // Featured launchers should have a helpful tooltip
  if (launcherData.isFeatured && !launcherData.helpText) {
    errors.helpText = 'Featured launchers should have help text';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * Validate manager relationship
 */
async function validateManagerRelationship(userId, managerId, usersCollection) {
  if (!managerId) return null;

  try {
    const manager = await usersCollection.findOne({ userId: managerId });
    if (!manager) {
      return { error: 'Manager user does not exist' };
    }

    if (managerId === userId) {
      return { error: 'User cannot be their own manager' };
    }

    return { valid: true };
  } catch (error) {
    return { error: 'Error validating manager relationship' };
  }
}

/**
 * Validate launcher creator
 */
async function validateLauncherCreator(createdBy, usersCollection) {
  if (!createdBy) return null;

  try {
    const creator = await usersCollection.findOne({ userId: createdBy });
    if (!creator) {
      return { error: 'Creator user does not exist' };
    }
    return { valid: true };
  } catch (error) {
    return { error: 'Error validating launcher creator' };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════

module.exports = {
  // Schemas
  createUserSchema,
  updateUserSchema,
  createLauncherSchema,
  updateLauncherSchema,

  // User validation
  validateCreateUser,
  validateUpdateUser,
  validateUserPermissions,
  validateManagerRelationship,

  // Launcher validation
  validateCreateLauncher,
  validateUpdateLauncher,
  validateLauncherVisibility,
  validateLauncherCreator,

  // Enums (for frontend use)
  enums: {
    roles: ['admin', 'manager', 'supervisor', 'staff', 'viewer'],
    departments: ['operations', 'sales', 'technical', 'finance', 'hr', 'admin', 'marketing', 'other'],
    userStatuses: ['active', 'inactive', 'on_leave', 'terminated'],
    launcherStatuses: ['active', 'inactive', 'hidden'],
    iconNames: ['dashboard', 'projects', 'clients', 'users', 'reports', 'settings', 'calendar', 'messages', 'files', 'analytics', 'inventory', 'billing', 'help', 'logout', 'profile'],
    iconStyles: ['outlined', 'filled', 'rounded', 'sharp']
  }
};