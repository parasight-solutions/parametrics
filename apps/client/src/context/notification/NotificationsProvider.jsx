import { notification, message as antdMessage } from "antd";

import { NotificationContext } from "./useNotify";

export function NotificationsProvider({ children }) {
  // Ant Design Notification
  const [api, contextHolder] = notification.useNotification();

  const baseConfig = {
    placement: "bottomRight",
    duration: 3,
    className: "custom-notification",
    style: {
      borderRadius: "12px",
      boxShadow: "0px 4px 10px rgba(0,0,0,0.2)",
    },
    showProgress: false,
    pauseOnHover: false,
  };

  const buildConfig = (message, description, icon, config) => {
    const finalConfig = { ...baseConfig, ...config, message };
    if (description) finalConfig.description = description;
    if (icon) finalConfig.icon = icon;
    return finalConfig;
  };

  const buildMessageContent = (msg, icon) => (
    <span className="flex items-center gap-2">
      {icon && <span className="flex">{icon}</span>}
      {msg}
    </span>
  );

  // Enhanced notification methods with optional storage
  const notify = {
    // Toast notifications with optional storage
    success: (message, description, icon = null, config = {}) => {
      api.success(buildConfig(message, description, icon, config));
    },

    error: (message, description, icon = null, config = {}) => {
      api.error(buildConfig(message, description, icon, config));
    },

    warning: (message, description, icon = null, config = {}) => {
      api.warning(buildConfig(message, description, icon, config));
    },

    info: (message, description, icon = null, config = {}) => {
      api.info(buildConfig(message, description, icon, config));
    },

    open: (message, description, icon = null, config = {}) => {
      api.open(buildConfig(message, description, icon, config));
    },

    // Simple messages with optional storage
    msgSuccess: (msg, icon = null, duration = 2) => {
      antdMessage.open({
        type: "success",
        content: buildMessageContent(msg, icon),
        duration,
      });
    },

    msgError: (msg, icon = null, duration = 2) => {
      antdMessage.open({
        type: "error",
        content: buildMessageContent(msg, icon),
        duration,
      });
    },

    msgWarning: (msg, icon = null, duration = 2) => {
      antdMessage.open({
        type: "warning",
        content: buildMessageContent(msg, icon),
        duration,
      });
    },

    msgInfo: (msg, icon = null, duration = 2) => {
      antdMessage.open({
        type: "info",
        content: buildMessageContent(msg, icon),
        duration,
      });
    },
  };

  return (
    <NotificationContext.Provider value={{ notify }}>
      {contextHolder}
      {children}
    </NotificationContext.Provider>
  );
}
