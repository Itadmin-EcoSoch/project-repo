/**
 * Users Table - Field Configuration
 * Complete user management system with roles and permissions
 */

// ═════════════════════════════════════════════════════════════════════════
// FIELD DEFINITIONS
// ═════════════════════════════════════════════════════════════════════════

export const usersFields = {
  userId: {
    name: 'userId',
    label: 'User ID',
    type: 'text',
    required: true,
    key: true,
    validation: (value) => {
      if (!value) return 'User ID is required';
      if (!/^[a-f0-9-]{36}$/.test(value)) return 'Invalid User ID format';
      return null;
    }
  },

  firstName: {
    name: 'firstName',
    label: 'First Name',
    type: 'text',
    required: true,
    maxLength: 100,
    validation: (value) => {
      if (!value) return 'First name is required';
      if (value.length < 2) return 'First name must be at least 2 characters';
      if (value.length > 100) return 'First name cannot exceed 100 characters';
      return null;
    }
  },

  lastName: {
    name: 'lastName',
    label: 'Last Name',
    type: 'text',
    required: true,
    maxLength: 100,
    validation: (value) => {
      if (!value) return 'Last name is required';
      if (value.length < 2) return 'Last name must be at least 2 characters';
      if (value.length > 100) return 'Last name cannot exceed 100 characters';
      return null;
    }
  },

  email: {
    name: 'email',
    label: 'Email Address',
    type: 'email',
    required: true,
    unique: true,
    validation: (value) => {
      if (!value) return 'Email is required';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) return 'Please enter a valid email address';
      return null;
    }
  },

  phone: {
    name: 'phone',
    label: 'Phone Number',
    type: 'phone',
    required: false,
    validation: (value) => {
      if (!value) return null;
      if (!/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/.test(value)) {
        return 'Please enter a valid phone number';
      }
      return null;
    }
  },

  username: {
    name: 'username',
    label: 'Username',
    type: 'text',
    required: true,
    unique: true,
    maxLength: 50,
    validation: (value) => {
      if (!value) return 'Username is required';
      if (!/^[a-zA-Z0-9_-]{3,50}$/.test(value)) {
        return 'Username must be 3-50 characters (alphanumeric, _, -)';
      }
      return null;
    }
  },

  role: {
    name: 'role',
    label: 'Role',
    type: 'enum',
    required: true,
    options: [
      { value: 'admin', label: 'Administrator' },
      { value: 'manager', label: 'Manager' },
      { value: 'supervisor', label: 'Supervisor' },
      { value: 'staff', label: 'Staff' },
      { value: 'viewer', label: 'Viewer' }
    ],
    default: 'staff',
    validation: (value) => {
      const validRoles = ['admin', 'manager', 'supervisor', 'staff', 'viewer'];
      if (!value) return 'Role is required';
      if (!validRoles.includes(value)) return 'Invalid role selected';
      return null;
    }
  },

  department: {
    name: 'department',
    label: 'Department',
    type: 'enum',
    required: true,
    options: [
      { value: 'operations', label: 'Operations' },
      { value: 'sales', label: 'Sales' },
      { value: 'technical', label: 'Technical' },
      { value: 'finance', label: 'Finance' },
      { value: 'hr', label: 'HR' },
      { value: 'admin', label: 'Administration' },
      { value: 'marketing', label: 'Marketing' },
      { value: 'other', label: 'Other' }
    ],
    default: 'operations',
    validation: (value) => {
      const validDepts = ['operations', 'sales', 'technical', 'finance', 'hr', 'admin', 'marketing', 'other'];
      if (!value) return 'Department is required';
      if (!validDepts.includes(value)) return 'Invalid department selected';
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
      { value: 'on_leave', label: 'On Leave', color: '#FFC107' },
      { value: 'terminated', label: 'Terminated', color: '#F44336' }
    ],
    default: 'active',
    validation: (value) => {
      const validStatus = ['active', 'inactive', 'on_leave', 'terminated'];
      if (!value) return 'Status is required';
      if (!validStatus.includes(value)) return 'Invalid status selected';
      return null;
    }
  },

  profilePicture: {
    name: 'profilePicture',
    label: 'Profile Picture',
    type: 'image',
    required: false,
    maxSize: 5 * 1024 * 1024, // 5MB
    validation: (file) => {
      if (!file) return null;
      if (!['image/jpeg', 'image/png', 'image/gif'].includes(file.type)) {
        return 'Only JPEG, PNG, and GIF images are allowed';
      }
      if (file.size > 5 * 1024 * 1024) {
        return 'Image size cannot exceed 5MB';
      }
      return null;
    }
  },

  bio: {
    name: 'bio',
    label: 'Bio',
    type: 'textarea',
    required: false,
    maxLength: 500,
    validation: (value) => {
      if (!value) return null;
      if (value.length > 500) return 'Bio cannot exceed 500 characters';
      return null;
    }
  },

  startDate: {
    name: 'startDate',
    label: 'Start Date',
    type: 'date',
    required: true,
    validation: (value) => {
      if (!value) return 'Start date is required';
      const date = new Date(value);
      if (isNaN(date.getTime())) return 'Invalid date format';
      return null;
    }
  },

  endDate: {
    name: 'endDate',
    label: 'End Date',
    type: 'date',
    required: false,
    validation: (value, formData) => {
      if (!value) return null;
      const date = new Date(value);
      if (isNaN(date.getTime())) return 'Invalid date format';
      if (formData?.startDate) {
        const startDate = new Date(formData.startDate);
        if (date < startDate) return 'End date cannot be before start date';
      }
      return null;
    }
  },

  managerId: {
    name: 'managerId',
    label: 'Reports To',
    type: 'ref',
    refTable: 'users',
    required: false,
    validation: (value) => {
      if (!value) return null;
      if (!/^[a-f0-9-]{36}$/.test(value)) return 'Invalid manager ID format';
      return null;
    }
  },

  permissionsLevel: {
    name: 'permissionsLevel',
    label: 'Permissions Level',
    type: 'number',
    required: true,
    min: 1,
    max: 5,
    default: 1,
    description: '1=Viewer, 2=Staff, 3=Supervisor, 4=Manager, 5=Admin',
    validation: (value) => {
      if (value === null || value === undefined) return 'Permissions level is required';
      const num = Number(value);
      if (!Number.isInteger(num)) return 'Permissions level must be a whole number';
      if (num < 1 || num > 5) return 'Permissions level must be between 1 and 5';
      return null;
    }
  },

  twoFactorEnabled: {
    name: 'twoFactorEnabled',
    label: 'Two-Factor Authentication',
    type: 'boolean',
    required: false,
    default: false
  },

  lastLogin: {
    name: 'lastLogin',
    label: 'Last Login',
    type: 'datetime',
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

export const computeFullName = (firstName, lastName) => {
  if (!firstName || !lastName) return '';
  return `${firstName} ${lastName}`.trim();
};

export const getUserInitials = (firstName, lastName) => {
  const first = firstName?.charAt(0)?.toUpperCase() || '';
  const last = lastName?.charAt(0)?.toUpperCase() || '';
  return `${first}${last}`;
};

export const getRoleColor = (role) => {
  const colors = {
    admin: '#D32F2F',
    manager: '#F57C00',
    supervisor: '#FBC02D',
    staff: '#388E3C',
    viewer: '#1976D2'
  };
  return colors[role] || '#757575';
};

export const getDepartmentIcon = (department) => {
  const icons = {
    operations: 'settings',
    sales: 'trending_up',
    technical: 'engineering',
    finance: 'attach_money',
    hr: 'people',
    admin: 'admin_panel_settings',
    marketing: 'campaign',
    other: 'info'
  };
  return icons[department] || 'info';
};

// ═════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═════════════════════════════════════════════════════════════════════════

export const validateUserData = (userData) => {
  const errors = {};

  // Required field checks
  const requiredFields = ['firstName', 'lastName', 'email', 'username', 'role', 'department', 'status', 'startDate'];
  requiredFields.forEach(field => {
    const fieldConfig = usersFields[field];
    if (fieldConfig.required && !userData[field]) {
      errors[field] = `${fieldConfig.label} is required`;
    }
  });

  // Field-specific validation
  Object.keys(usersFields).forEach(key => {
    const field = usersFields[key];
    const value = userData[key];

    if (value && field.validation) {
      const error = field.validation(value, userData);
      if (error) errors[key] = error;
    }
  });

  return Object.keys(errors).length > 0 ? errors : null;
};

export const formatUserDisplay = (user) => {
  return {
    ...user,
    fullName: computeFullName(user.firstName, user.lastName),
    initials: getUserInitials(user.firstName, user.lastName),
    roleColor: getRoleColor(user.role),
    departmentIcon: getDepartmentIcon(user.department),
    displayName: `${user.firstName} ${user.lastName}`
  };
};

// ═════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════

export default {
  fields: usersFields,
  computeFullName,
  getUserInitials,
  getRoleColor,
  getDepartmentIcon,
  validateUserData,
  formatUserDisplay
};