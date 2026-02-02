# AgentPlane Agent Container
# Used by Cloudflare Container runtime for isolated agent execution

FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN useradd -m -s /bin/bash agent
WORKDIR /home/agent

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Copy entrypoint script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Switch to non-root user
USER agent

# Set up agent working directory
RUN mkdir -p /home/agent/workspace /home/agent/.claude

# Environment variables (overridden at runtime)
ENV AGENT_SKILLS=""
ENV AGENT_COMMANDS=""
ENV MCP_SERVERS="{}"
ENV ANTHROPIC_API_KEY=""
ENV BEDROCK_REGION=""
ENV BEDROCK_MODEL=""

ENTRYPOINT ["/entrypoint.sh"]
