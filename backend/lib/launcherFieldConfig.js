/**
 * Launcher Table - Field Configuration
 * App navigation, menu items, and launcher button configuration
 */

// ═════════════════════════════════════════════════════════════════════════
// FIELD DEFINITIONS
// ═════════════════════════════════════════════════════════════════════════

export const launcherFields = {
  launcherId: {
    name: 'launcherId',
    label: 'Launcher ID',
    type: 'text',
    required: true,
    key: true,
    validation: (value) => {
      if (!value) return 'Launcher ID is required';
      if (!/^[a-f0-9-]{36}$/.test(value)) return 'Invalid Launcher ID format';
      return null;
    }
  },

  title: {
    name: 'title',
    label: 'Title',
    type: 'text',
    required: true,
    maxLength: 100,
    validation: (value) => {
      if (!value) return 'Title is required';
      if (value.length < 2) return 'Title must be at least 2 characters';
      if (value.length > 100) return 'Title cannot exceed 100 characters';
      return null;
    }
  },

  description: {
    name: 'description',
    label: 'Description',
    type: 'textarea',
    required: false,
    maxLength: 500,
    validation: (value) => {
      if (!value) return null;
      if (value.length > 500) return 'Description cannot exceed 500 characters';
      return null;
    }
  },

  iconName: {
    name: 'iconName',
    label: 'Icon Name',
    type: 'enum',
    required: true,
    options: [
      { value: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { value: 'projects', label: 'Projects', icon: 'assignment' },
      { value: 'clients', label: 'Clients', icon: 'person' },
      { value: 'users', label: 'Users', icon: 'group' },
      { value: 'reports', label: 'Reports', icon: 'assessment' },
      { value: 'settings', label: 'Settings', icon: 'settings' },
      { value: 'calendar', label: 'Calendar', icon: 'calendar_today' },
      { value: 'messages', label: 'Messages', icon: 'message' },
      { value: 'files', label: 'Files', icon: 'folder' },
      { value: 'analytics', label: 'Analytics', icon: 'analytics' },
      { value: 'inventory', label: 'Inventory', icon: 'inventory' },
      { value: 'billing', label: 'Billing', icon: 'receipt' },
      { value: 'help', label: 'Help', icon: 'help' },
      { value: 'logout', label: 'Logout', icon: 'logout' },
      { value: 'profile', label: 'Profile', icon: 'account_circle' }
    ],
    default: 'dashboard',
    validation: (value) => {
      if (!value) return 'Icon name is required';
      return null;
    }
  },

  iconURL: {
    name: 'iconURL',
    label: 'Custom Icon URL',
    type: 'url',
    required: false,
    validation: (value) => {
      if (!value) return null;
      try {
        new URL(value);
        return null;
      } catch {
        return 'Please enter a valid URL';
      }
    }
  },

  targetApp: {
    name: 'targetApp',
    label: 'Target App',
    type: 'text',
    required: false,
    maxLength: 255,
    description: 'AppSheet app ID or name',
    validation: (value) => {
      if (!value) return null;
      if (value.length > 255) return 'App ID cannot exceed 255 characters';
      return null;
    }
  },

  targetView: {
    name: 'targetView',
    label: 'Target View',
    type: 'text',
    required: false,
    maxLength: 255,
    description: 'Target view or page name',
    validation: (value) => {
      if (!value) return null;
      if (value.length > 255) return 'View name cannot exceed 255 characters';
      return null;
    }
  },

  externalURL: {
    name: 'externalURL',
    label: 'External URL',
    type: 'url',
    required: false,
    validation: (value) => {
      if (!value) return null;
      try {
        new URL(value);
        return null;
      } catch {
        return 'Please enter a valid URL';
      }
    }
  },

  orderIndex: {
    name: 'orderIndex',
    label: 'Display Order',
    type: 'number',
    required: true,
    min: 1,
    max: 999,
    default: 1,
    description: 'Order in which to display (lower numbers appear first)',
    validation: (value) => {
      if (value === null || value === undefined) return 'Order index is required';
      const num = Number(value);
      if (!Number.isInteger(num)) return 'Order must be a whole number';
      if (num < 1 || num > 999) return 'Order must be between 1 and 999';
      return null;
    }
  },

  status: {
    name: 'status',
    label: 'Status',
    type: 'enum',
    required: true,
    options: [
      { value: 'active', label: 'Active', color: '#4CAF50' },
      { value: 'inactive', label: 'Inactive', color: '#9E9E9E' },
      { value: 'hidden', label: 'Hidden', color: '#757575' }
    ],
    default: 'active',
    validation: (value) => {
      const validStatus = ['active', 'inactive', 'hidden'];
      if (!value) return 'Status is required';
      if (!validStatus.includes(value)) return 'Invalid status selected';
      return null;
    }
  },

  roleRestrictions: {
    name: 'roleRestrictions',
    label: 'Visible To Roles',
    type: 'enumList',
    required: false,
    options: [
      { value: 'admin', label: 'Administrator' },
      { value: 'manager', label: 'Manager' },
      { value: 'supervisor', label: 'Supervisor' },
      { value: 'staff', label: 'Staff' },
      { value: 'viewer', label: 'Viewer' }
    ],
    description: 'Leave empty to show to all roles',
    validation: (value) => {
      if (!value) return null;
      const validRoles = ['admin', 'manager', 'supervisor', 'staff', 'viewer'];
      if (Array.isArray(value)) {
        const invalid = value.filter(v => !validRoles.includes(v));
        if (invalid.length > 0) return 'Invalid role(s) selected';
      }
      return null;
    }
  },

  departmentRestrictions: {
    name: 'departmentRestrictions',
    label: 'Visible To Departments',
    type: 'enumList',
    required: false,
    options: [
      { value: 'operations', label: 'Operations' },
      { value: 'sales', label: 'Sales' },
      { value: 'technical', label: 'Technical' },
      { value: 'finance', label: 'Finance' },
      { value: 'hr', label: 'HR' },
      { value: 'admin', label: 'Administration' },
      { value: 'marketing', label: 'Marketing' }
    ],
    description: 'Leave empty to show to all departments',
    validation: (value) => {
      if (!value) return null;
      const validDepts = ['operations', 'sales', 'technical', 'finance', 'hr', 'admin', 'marketing'];
      if (Array.isArray(value)) {
        const invalid = value.filter(v => !validDepts.includes(v));
        if (invalid.length > 0) return 'Invalid department(s) selected';
      }
      return null;
    }
  },

  color: {
    name: 'color',
    label: 'Button Color',
    type: 'color',
    required: false,
    default: '#2196F3',
    description: 'Hex color for button/tile',
    validation: (value) => {
      if (!value) return null;
      if (!/^#[0-9A-F]{6}$/i.test(value)) return 'Please enter a valid hex color (e.g., #FF9800)';
      return null;
    }
  },

  iconStyle: {
    name: 'iconStyle',
    label: 'Icon Style',
    type: 'enum',
    required: false,
    options: [
      { value: 'outlined', label: 'Outlined' },
      { value: 'filled', label: 'Filled' },
      { value: 'rounded', label: 'Rounded' },
      { value: 'sharp', label: 'Sharp' }
    ],
    default: 'filled',
    validation: (value) => {
      const validStyles = ['outlined', 'filled', 'rounded', 'sharp'];
      if (value && !validStyles.includes(value)) return 'Invalid icon style';
      return null;
    }
  },

  badgeCount: {
    name: 'badgeCount',
    label: 'Badge Count',
    type: 'number',
    required: false,
    min: 0,
    validation: (value) => {
      if (!value) return null;
      const num = Number(value);
      if (num < 0) return 'Badge count cannot be negative';
      return null;
    }
  },

  isFeatured: {
    name: 'isFeatured',
    label: 'Feature on Home Screen',
    type: 'boolean',
    required: false,
    default: false
  },

  helpText: {
    name: 'helpText',
    label: 'Help/Tooltip Text',
    type: 'text',
    required: false,
    maxLength: 500,
    description: 'Displayed on hover or help',
    validation: (value) => {
      if (!value) return null;
      if (value.length > 500) return 'Help text cannot exceed 500 characters';
      return null;
    }
  },

  createdBy: {
    name: 'createdBy',
    label: 'Created By',
    type: 'ref',
    refTable: 'users',
    required: false,
    readOnly: true
  },

  createdAt: {
    name: 'createdAt',
    label: 'Created Date',
    type: 'datetime',
    required: false,
    readOnly: true
  },

  updatedAt: {
    name: 'updatedAt',
    label: 'Updated Date',
    type: 'datetime',
    required: false,
    readOnly: true
  }
};

// ═════════════════════════════════════════════════════════════════════════
// COMPUTED FIELDS
// ═════════════════════════════════════════════════════════════════════════

export const isLauncherVisible = (launcher, userRole, userDepartment) => {
  // Check status
  if (launcher.status === 'inactive' || launcher.status === 'hidden') {
    return false;
  }

  // Check role restrictions
  if (launcher.roleRestrictions && launcher.roleRestrictions.length > 0) {
    if (!launcher.roleRestrictions.includes(userRole)) {
      return false;
    }
  }

  // Check department restrictions
  if (launcher.departmentRestrictions && launcher.departmentRestrictions.length > 0) {
    if (!launcher.departmentRestrictions.includes(userDepartment)) {
      return false;
    }
  }

  return true;
};

export const getLauncherIcon = (launcher) => {
  return launcher.iconURL || launcher.iconName;
};

export const getLauncherTarget = (launcher) => {
  if (launcher.externalURL) {
    return { type: 'external', url: launcher.externalURL };
  }
  if (launcher.targetApp && launcher.targetView) {
    return { type: 'app', app: launcher.targetApp, view: launcher.targetView };
  }
  if (launcher.targetApp) {
    return { type: 'app', app: launcher.targetApp };
  }
  return null;
};

// ═════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════

export const validateLauncherData = (launcherData) => {
  const errors = {};

  // Required field checks
  const requiredFields = ['title', 'iconName', 'orderIndex', 'status'];
  requiredFields.forEach(field => {
    const fieldConfig = launcherFields[field];
    if (fieldConfig.required && !launcherData[field]) {
      errors[field] = `${fieldConfig.label} is required`;
    }
  });

  // Must have at least one target
  const hasTarget = launcherData.targetApp || launcherData.externalURL;
  if (!hasTarget) {
    errors.target = 'Please specify either a Target App or External URL';
  }

  // Field-specific validation
  Object.keys(launcherFields).forEach(key => {
    const field = launcherFields[key];
    const value = launcherData[key];

    if (value && field.validation) {
      const error = field.validation(value, launcherData);
      if (error) errors[key] = error;
    }
  });

  return Object.keys(errors).length > 0 ? errors : null;
};

export const formatLauncherDisplay = (launcher, users) => {
  return {
    ...launcher,
    target: getLauncherTarget(launcher),
    icon: getLauncherIcon(launcher),
    createdByName: users?.find(u => u.userId === launcher.createdBy)?.firstName
  };
};

export const getLaunchersByRole = (launchers, userRole, userDepartment) => {
  return launchers
    .filter(l => isLauncherVisible(l, userRole, userDepartment))
    .sort((a, b) => a.orderIndex - b.orderIndex);
};

export const groupLaunchersByCategory = (launchers) => {
  const categories = {
    main: [],
    management: [],
    reporting: [],
    system: []
  };

  launchers.forEach(launcher => {
    if (['dashboard', 'projects', 'clients'].includes(launcher.iconName)) {
      categories.main.push(launcher);
    } else if (['users', 'reports', 'analytics', 'calendar'].includes(launcher.iconName)) {
      categories.management.push(launcher);
    } else if (['billing', 'inventory', 'files'].includes(launcher.iconName)) {
      categories.reporting.push(launcher);
    } else {
      categories.system.push(launcher);
    }
  });

  return categories;
};

// ═════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════

export default {
  fields: launcherFields,
  isLauncherVisible,
  getLauncherIcon,
  getLauncherTarget,
  validateLauncherData,
  formatLauncherDisplay,
  getLaunchersByRole,
  groupLaunchersByCategory
};