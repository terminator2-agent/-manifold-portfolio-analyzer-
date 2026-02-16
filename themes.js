/**
 * Theme Switcher for Manifold Portfolio Analyzer
 *
 * Adds user-selectable stylesheets with localStorage persistence.
 * Themes: Default, Money, MySpace 2005, Lisa Frank Notebook,
 *         Running Out of Oxygen, How It's Made: Manifold Markets
 */

(function() {
    'use strict';

    const THEMES = [
        { id: 'default',     name: 'Default',                        className: '' },
        { id: 'money',       name: '\uD83D\uDCB0 Money',             className: 'theme-money' },
        { id: 'myspace',     name: '\uD83D\uDC7E MySpace 2005',      className: 'theme-myspace' },
        { id: 'lisafrank',   name: '\uD83C\uDF08 Lisa Frank Notebook', className: 'theme-lisafrank' },
        { id: 'oxygen',      name: '\uD83E\uDEC1 Running Out of Oxygen', className: 'theme-oxygen' },
        { id: 'howitsmade',  name: '\u2699\uFE0F How It\'s Made',     className: 'theme-howitsmade' }
    ];

    const STORAGE_KEY = 'manifold-portfolio-theme';

    /**
     * Apply a theme by adding its CSS class to the body
     */
    function applyTheme(themeId) {
        const theme = THEMES.find(t => t.id === themeId) || THEMES[0];

        // Remove all theme classes
        THEMES.forEach(t => {
            if (t.className) {
                document.body.classList.remove(t.className);
            }
        });

        // Apply new theme class
        if (theme.className) {
            document.body.classList.add(theme.className);
        }

        // Persist choice
        try {
            localStorage.setItem(STORAGE_KEY, theme.id);
        } catch (e) {
            // localStorage may be unavailable; fail silently
        }

        // Update selector if it exists
        const selector = document.getElementById('theme-selector');
        if (selector && selector.value !== theme.id) {
            selector.value = theme.id;
        }
    }

    /**
     * Get the saved theme from localStorage
     */
    function getSavedTheme() {
        try {
            return localStorage.getItem(STORAGE_KEY) || 'default';
        } catch (e) {
            return 'default';
        }
    }

    /**
     * Build and inject the theme switcher UI into the header
     */
    function createThemeSwitcher() {
        const container = document.createElement('div');
        container.className = 'theme-switcher';

        const label = document.createElement('label');
        label.setAttribute('for', 'theme-selector');
        label.textContent = 'Theme:';

        const select = document.createElement('select');
        select.id = 'theme-selector';

        THEMES.forEach(theme => {
            const option = document.createElement('option');
            option.value = theme.id;
            option.textContent = theme.name;
            select.appendChild(option);
        });

        select.value = getSavedTheme();

        select.addEventListener('change', function() {
            applyTheme(this.value);
        });

        container.appendChild(label);
        container.appendChild(select);

        // Insert after the header subtitle
        const header = document.querySelector('header');
        if (header) {
            header.appendChild(container);
        }
    }

    /**
     * Initialize: apply saved theme immediately, then build UI when DOM is ready
     */
    // Apply theme class as early as possible to prevent flash
    const savedTheme = getSavedTheme();
    if (savedTheme !== 'default') {
        const theme = THEMES.find(t => t.id === savedTheme);
        if (theme && theme.className) {
            // Apply immediately if body exists, otherwise wait
            if (document.body) {
                document.body.classList.add(theme.className);
            } else {
                document.addEventListener('DOMContentLoaded', function() {
                    applyTheme(savedTheme);
                });
            }
        }
    }

    // Build the UI when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            createThemeSwitcher();
            applyTheme(getSavedTheme());
        });
    } else {
        createThemeSwitcher();
        applyTheme(getSavedTheme());
    }
})();
