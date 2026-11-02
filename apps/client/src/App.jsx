import { BrowserRouter, Outlet, Router } from "react-router-dom";

const GuestWrapper = () => {
  return <Outlet />;
};

const App = () => {
  return (
    <BrowserRouter>
      <Router></Router>
    </BrowserRouter>
  );
};

export default App;
