import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0b1016",
        panel: "#0d131d"
      }
    }
  },
  plugins: []
} satisfies Config;
