// .eslintrc.js
module.exports = {
    env: {
        node: true,
        es2021: true,
    },
    extends: ['eslint:recommended', 'plugin:prettier/recommended'],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'script', // ou "module" si tu veux utiliser import/export
    },
    rules: {
        'no-unused-vars': 'warn',
        'no-console': 'off',
    },
};
