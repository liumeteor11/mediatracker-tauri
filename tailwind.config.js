/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Enable class-based dark mode
  theme: {
    extend: {
      colors: {
        cinema: {
          900: '#121212', // Base dark
          800: '#1E1E1E', // Secondary dark
          700: '#2D2D2D',
          gold: '#FFD700', // Gold accent
          amber: '#FFBF00', // Amber accent
        },
        theme: {
            bg: 'var(--bg-primary)',
            surface: 'var(--bg-secondary)',
            text: 'var(--text-primary)',
            subtext: 'var(--text-secondary)',
            accent: 'var(--accent-primary)',
            'accent-hover': 'var(--accent-secondary)',
            'accent-warm': 'var(--accent-warm-primary)',
            'accent-warm-2': 'var(--accent-warm-secondary)',
            border: 'var(--border-color)',
            shadow: 'var(--shadow-color)',
        }
      },
      fontFamily: {
        sans: ['system-ui', 'sans-serif'],
        theme: ['var(--font-theme)', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-in-from-bottom-2': 'slideInFromBottom 0.3s ease-out',
        'flip': 'flip 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
        'spotlight': 'spotlight 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideInFromBottom: {
          '0%': { transform: 'translateY(0.5rem)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        spotlight: {
            '0%, 100%': { opacity: '0.5', transform: 'scale(1)' },
            '50%': { opacity: '1', transform: 'scale(1.1)' },
        }
      },
      backgroundImage: {
        'curtain-gradient': 'linear-gradient(to right, #000000 0%, #1a1a1a 50%, #000000 100%)',
        'gold-gradient': 'linear-gradient(45deg, #FFD700, #FFBF00)',
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: '100%',
            color: 'var(--text-primary)',
            '[class~="lead"]': {
              color: 'var(--text-secondary)',
            },
            a: {
              color: 'var(--accent-primary)',
              '&:hover': {
                color: 'var(--accent-secondary)',
              },
            },
            strong: {
              color: 'var(--text-primary)',
            },
            'ol > li::marker': {
              color: 'var(--text-secondary)',
            },
            'ul > li::marker': {
              color: 'var(--text-secondary)',
            },
            hr: {
              borderColor: 'var(--border-color)',
            },
            blockquote: {
              color: 'var(--text-secondary)',
              borderLeftColor: 'var(--border-color)',
            },
            h1: {
              color: 'var(--text-primary)',
            },
            h2: {
              color: 'var(--text-primary)',
            },
            h3: {
              color: 'var(--text-primary)',
            },
            h4: {
              color: 'var(--text-primary)',
            },
            'figure figcaption': {
              color: 'var(--text-secondary)',
            },
            code: {
              color: 'var(--text-primary)',
            },
            'a code': {
              color: 'var(--accent-primary)',
            },
            pre: {
              color: 'var(--text-primary)',
              backgroundColor: 'var(--bg-secondary)',
            },
            thead: {
              color: 'var(--text-primary)',
              borderBottomColor: 'var(--border-color)',
            },
            'tbody tr': {
              borderBottomColor: 'var(--border-color)',
            },
          },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
