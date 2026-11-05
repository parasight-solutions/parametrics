import { useEffect, useState } from "react";

import { NavLink, useLocation } from "react-router-dom";
import {
  LogOut,
  LayoutDashboard,
  ChevronDown,
  Workflow,
  StickyNotes,
  UserStar,
  FileText,
  UsersRound,
  Repeat,
  Cog,
} from "lucide-react";

import { useAuth } from "../context/auth/useAuth";

const NAV_ITEMS = [
  {
    name: "Dashboard",
    path: "dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Integrations",
    path: "integrations",
    icon: Workflow,
  },
  {
    name: "Posts",
    path: "posts",
    icon: StickyNotes,
  },
  {
    name: "Reviews",
    path: "reviews",
    icon: UserStar,
  },
  {
    name: "Reports",
    path: "reports",
    icon: FileText,
  },
  {
    name: "Members",
    path: "organization-members",
    icon: UsersRound,
  },
  {
    name: "Tools",
    icon: Cog,
    children: [
      {
        name: "Recurrence Lab",
        path: "recurrence",
        icon: Repeat,
      },
    ],
  },
];

const menuStyle =
  "px-3 py-2.5 flex items-center gap-2.5 text-sm min-w-45 rounded-md transition-all";

const getMenuKey = (menu) => menu.path ?? menu.name;

const isRouteActive = (pathname, path) => {
  const routePath = `/${path}`;

  return pathname === routePath || pathname.startsWith(`${routePath}/`);
};

const NavItem = ({ menu, pathname, isExpanded, onToggle, onClose }) => {
  const Icon = menu.icon;
  const hasChildren = Boolean(menu.children?.length);
  const menuKey = getMenuKey(menu);
  const isParentActive = hasChildren
    ? menu.children.some((child) => isRouteActive(pathname, child.path))
    : isRouteActive(pathname, menu.path);
  const menuClassName = (active) => `border-r-3 ${menuStyle}
    ${
      active
        ? "bg-[#F0F0F0] text-[#7851A9] font-medium border-[#7851A9]"
        : hasChildren && isExpanded
          ? "text-[#585F67] bg-gray-100 text-gray-800 border-transparent"
          : "text-[#585F67] hover:bg-gray-100 hover:text-gray-800 border-transparent"
    }`;
  const menuContent = (
    <>
      <Icon size={17} />
      <p className="text-nowrap">{menu.name}</p>

      {hasChildren && (
        <ChevronDown
          size={16}
          className={`ml-auto transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-1">
      {hasChildren ? (
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={() => onToggle(menuKey, isExpanded)}
          className={`${menuClassName(isParentActive)} cursor-pointer`}
        >
          {menuContent}
        </button>
      ) : (
        <NavLink
          to={menu.path}
          onClick={onClose}
          className={({ isActive }) => menuClassName(isActive)}
        >
          {menuContent}
        </NavLink>
      )}

      {hasChildren && isExpanded && (
        <div className="ml-2 pl-1 flex flex-col gap-1 border-l-2 border-[#7851A9]/80">
          {menu.children.map((child) => {
            const ChildIcon = child.icon;

            return (
              <NavLink
                key={child.path}
                to={child.path}
                end
                onClick={onClose}
                className={({ isActive }) =>
                  `px-3 py-2 flex items-center gap-2 text-[13px] rounded-md transition-colors ${
                    isActive
                      ? "bg-purple-50 text-[#7851A9] font-medium"
                      : "text-[#717781] hover:bg-gray-100 hover:text-gray-800"
                  }`
                }
              >
                <ChildIcon size={15} />
                <span className="text-nowrap">{child.name}</span>
              </NavLink>
            );
          })}
        </div>
      )}
    </div>
  );
};

const SideBar = ({ isOpen, onClose }) => {
  const { logout } = useAuth();

  const location = useLocation();
  const [expandedMenus, setExpandedMenus] = useState({});

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "auto";
  }, [isOpen]);

  const isMenuExpanded = (menu) => {
    const menuKey = getMenuKey(menu);

    if (Object.hasOwn(expandedMenus, menuKey)) {
      return expandedMenus[menuKey];
    }

    return menu.children?.some((child) =>
      isRouteActive(location.pathname, child.path),
    );
  };

  const toggleMenu = (menuKey, isExpanded) => {
    setExpandedMenus((current) => ({
      ...current,
      [menuKey]: !isExpanded,
    }));
  };

  return (
    <div className="h-full min-h-0 flex flex-col overflow-hidden border-r border-gray-200">
      {/* Header */}
      <header className="shrink-0 ml-5 px-2.5 py-5 flex items-center">
        <p className="font-semibold">Parametrics</p>
      </header>

      {/* Menus */}
      <div className="flex-1 min-h-0 pb-3 flex flex-col gap-2 overflow-hidden">
        <nav className="flex-1 min-h-0 px-2.5 flex flex-col gap-1.5 overflow-y-auto">
          {NAV_ITEMS.map((menu) => {
            return (
              <NavItem
                key={menu.name}
                menu={menu}
                pathname={location.pathname}
                isExpanded={isMenuExpanded(menu)}
                onToggle={toggleMenu}
                onClose={onClose}
              />
            );
          })}
        </nav>

        {/* Logout */}
        <div className="px-2.5">
          <button
            onClick={() => {
              logout();
              onClose();
            }}
            className={`${menuStyle} w-full shrink-0 text-red-500 hover:text-red-600 hover:bg-red-50`}
          >
            <LogOut size={17} />
            <p className="text-nowrap">Logout</p>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SideBar;
