import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import DonatePage from "./DonatePage.jsx";
import DonorPage from "./DonorPage.jsx";
import "./index.css";

// Three entry points, no router dependency: the public /donate page (no auth),
// the donor portal at /my (donor phone+PIN auth), and the admin app at
// everything else.
const path = window.location.pathname.replace(/\/+$/, "");

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {path === "/donate" ? <DonatePage /> : path === "/my" ? <DonorPage /> : <App />}
  </React.StrictMode>
);
