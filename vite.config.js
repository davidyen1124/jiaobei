import { defineConfig } from 'vite';

// Relative base so the same build works at a domain root or under a sub-path
// such as GitHub Pages' https://<user>.github.io/jiaobei/.
export default defineConfig({
  base: './',
});
