import { createContext, useContext } from "react";

export const LocationContext = createContext(null);

export const useLocation = () => {
  const context = useContext(LocationContext);

  if (!context) {
    throw new Error("useLocation must be used within a LocationProvider");
  }

  return context;
};
