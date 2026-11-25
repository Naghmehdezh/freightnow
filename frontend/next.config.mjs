/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained server bundle (.next/standalone) for the Docker image.
  output: 'standalone',
};

export default nextConfig;
