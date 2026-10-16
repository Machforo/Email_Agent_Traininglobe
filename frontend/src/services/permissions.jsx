import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';

const PermissionContext = createContext(null);

export function PermissionProvider({ children, user, onUserUpdate }) {
  const [currentUser, setCurrentUser] = useState(user);

  useEffect(() => {
    setCurrentUser(user);
  }, [user]);

  // Synchronize fresh permissions from /auth/me on mount or token change
  useEffect(() => {
    const token = localStorage.getItem('traininglobe_token');
    if (token) {
      api.getMe()
        .then((freshUser) => {
          if (freshUser && freshUser.id) {
            setCurrentUser(freshUser);
            localStorage.setItem('traininglobe_user', JSON.stringify(freshUser));
            if (onUserUpdate) onUserUpdate(freshUser);
          }
        })
        .catch((err) => {
          console.warn('Could not refresh user permissions:', err);
        });
    }
  }, []);

  const permissions = currentUser?.permissions || [];
  const isReadOnly = currentUser?.is_read_only ?? (currentUser?.role !== 'SUPER_ADMIN');

  const hasPermission = (permission) => {
    if (!permission) return true;
    return permissions.includes(permission);
  };

  const can = hasPermission;

  const value = {
    user: currentUser,
    permissions,
    isReadOnly,
    hasPermission,
    can,
  };

  return (
    <PermissionContext.Provider value={value}>
      {children}
    </PermissionContext.Provider>
  );
}

export function usePermissions() {
  const context = useContext(PermissionContext);
  if (!context) {
    // Fallback if used outside Provider: read from localStorage safely
    try {
      const saved = JSON.parse(localStorage.getItem('traininglobe_user') || 'null');
      const perms = saved?.permissions || [];
      const readOnly = saved?.is_read_only ?? (saved?.role !== 'SUPER_ADMIN');
      return {
        user: saved,
        permissions: perms,
        isReadOnly: readOnly,
        hasPermission: (p) => !p || perms.includes(p),
        can: (p) => !p || perms.includes(p),
      };
    } catch {
      return {
        user: null,
        permissions: [],
        isReadOnly: true,
        hasPermission: () => false,
        can: () => false,
      };
    }
  }
  return context;
}

export function Can({ permission, children, fallback = null }) {
  const { hasPermission } = usePermissions();
  if (!hasPermission(permission)) {
    return fallback;
  }
  return <>{children}</>;
}
