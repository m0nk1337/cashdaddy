FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile \
 && pnpm add -D @tailwindcss/oxide-linux-x64-gnu@4.3.3
COPY . .
ARG NEXT_PUBLIC_API_URL=http://localhost:5001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm exec next build
EXPOSE 3000
# next start binds 0.0.0.0 by default and respects $PORT (Render sets PORT=10000)
CMD ["sh", "-c", "pnpm exec next start -p ${PORT:-3000}"]
