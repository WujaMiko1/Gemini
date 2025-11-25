/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './renderer/index.html',
    './renderer/src/**/*.{ts,tsx,js,jsx,html,css}',
    './renderer/src/assets/site/**/*.{css,html,js,ts,tsx}'
  ],
  theme: { extend: {} },
  plugins: [],
};
