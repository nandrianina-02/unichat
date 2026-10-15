import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FournisseurCompte } from "./lib/compte";
import { lireLienContact } from "./lib/invitation";
import "./styles.css";

lireLienContact();

createRoot(document.getElementById("racine")!).render(
  <StrictMode>
    <FournisseurCompte>
      <App />
    </FournisseurCompte>
  </StrictMode>,
);
