/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",              // il motore è puro: niente jsdom
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 30000,               // i test di generazione girano il multi-tentativo
  },
});
