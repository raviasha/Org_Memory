/** @type {import('next').NextConfig} */
const nextConfig = {
  // Transpile workspace packages
  transpilePackages: ["@org-memory/types", "@org-memory/validators"],
};

module.exports = nextConfig;
