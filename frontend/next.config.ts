import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';
import path from 'node:path';
// Keep production builds from replacing a running dev server's webpack modules.
const nextConfig = (phase: string): NextConfig => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next',
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd()),
  experimental: {proxyTimeout: 180000},
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${process.env.BACKEND_URL || 'http://127.0.0.1:8000'}/api/:path*` }];
  },
});
export default nextConfig;
