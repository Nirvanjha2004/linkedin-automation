import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        primary: {
          DEFAULT: 'rgb(79 70 229)',
          foreground: 'rgb(255 255 255)',
          50: 'rgb(238 242 255)',
          100: 'rgb(224 231 255)',
          600: 'rgb(79 70 229)',
          700: 'rgb(67 56 202)',
        },
        border: 'rgb(228 228 231)',
        muted: {
          DEFAULT: 'rgb(244 244 245)',
          foreground: 'rgb(113 113 122)',
        },
      },
      fontSize: {
        '2xs': ['10px', '14px'],
      },
    },
  },
  plugins: [],
};

export default config;
