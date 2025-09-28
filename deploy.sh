#!/bin/bash

# Grab Order Fetcher Bot - Deployment Script
# This script helps deploy the bot to Render or other platforms

set -e

echo "🚗 Grab Order Fetcher Bot - Deployment Script"
echo "=============================================="

# Check if required environment variables are set
check_env_vars() {
    echo "📋 Checking environment variables..."
    
    required_vars=(
        "GRAB_USERNAME"
        "GRAB_PASSWORD"
        "MONGODB_URI"
    )
    
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        echo "❌ Missing required environment variables:"
        printf '   - %s\n' "${missing_vars[@]}"
        echo ""
        echo "Please set these variables before deploying:"
        echo "export GRAB_USERNAME='your_grab_email@example.com'"
        echo "export GRAB_PASSWORD='your_grab_password'"
        echo "export MONGODB_URI='mongodb+srv://...'"
        exit 1
    fi
    
    echo "✅ All required environment variables are set"
}

# Install dependencies
install_dependencies() {
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
}

# Run tests (if any)
run_tests() {
    echo "🧪 Running tests..."
    # Add test commands here when tests are implemented
    echo "✅ Tests passed (no tests implemented yet)"
}

# Build for production
build_production() {
    echo "🏗️  Building for production..."
    # No build step needed for this Node.js app
    echo "✅ Build completed"
}

# Deploy to Render
deploy_to_render() {
    echo "🚀 Deploying to Render..."
    
    # Check if git is initialized
    if [ ! -d ".git" ]; then
        echo "📝 Initializing git repository..."
        git init
        git add .
        git commit -m "Initial commit for Grab Order Fetcher Bot"
    fi
    
    echo "📋 Deployment checklist:"
    echo "1. Create a new Web Service on Render (https://render.com)"
    echo "2. Connect your GitHub repository"
    echo "3. Set the following environment variables in Render dashboard:"
    echo "   - GRAB_USERNAME: ${GRAB_USERNAME}"
    echo "   - GRAB_PASSWORD: [HIDDEN]"
    echo "   - MONGODB_URI: [HIDDEN]"
    echo "   - NODE_ENV: production"
    echo "   - HEADLESS_MODE: true"
    echo "   - SCREENSHOT_ENABLED: true"
    echo "   - POLLING_INTERVAL_MINUTES: 2"
    echo "4. Set Build Command: npm install"
    echo "5. Set Start Command: npm start"
    echo "6. Deploy!"
    echo ""
    echo "📖 For detailed instructions, see README.md"
}

# Local development setup
setup_local() {
    echo "💻 Setting up local development environment..."
    
    # Copy environment file
    if [ ! -f ".env" ]; then
        cp .env.example .env
        echo "📝 Created .env file from .env.example"
        echo "Please edit .env file with your credentials"
    else
        echo "📝 .env file already exists"
    fi
    
    # Install dependencies
    install_dependencies
    
    echo "✅ Local setup completed"
    echo ""
    echo "To start the bot locally:"
    echo "1. Edit .env file with your credentials"
    echo "2. Run: npm start"
}

# Docker deployment
deploy_docker() {
    echo "🐳 Building Docker image..."
    
    docker build -t grab-order-fetcher .
    
    echo "✅ Docker image built successfully"
    echo ""
    echo "To run with Docker:"
    echo "docker run -d --name grab-bot \\"
    echo "  -e GRAB_USERNAME='${GRAB_USERNAME}' \\"
    echo "  -e GRAB_PASSWORD='${GRAB_PASSWORD}' \\"
    echo "  -e MONGODB_URI='${MONGODB_URI}' \\"
    echo "  grab-order-fetcher"
}

# Health check
health_check() {
    echo "🔍 Running health check..."
    
    # Check if MongoDB URI is valid format
    if [[ ! "$MONGODB_URI" =~ ^mongodb(\+srv)?:// ]]; then
        echo "❌ Invalid MongoDB URI format"
        exit 1
    fi
    
    # Check if credentials are not empty
    if [ -z "$GRAB_USERNAME" ] || [ -z "$GRAB_PASSWORD" ]; then
        echo "❌ Grab credentials are empty"
        exit 1
    fi
    
    echo "✅ Health check passed"
}

# Main menu
show_menu() {
    echo ""
    echo "Select deployment option:"
    echo "1) Setup local development"
    echo "2) Deploy to Render"
    echo "3) Build Docker image"
    echo "4) Run health check"
    echo "5) Exit"
    echo ""
    read -p "Enter your choice (1-5): " choice
    
    case $choice in
        1)
            setup_local
            ;;
        2)
            check_env_vars
            health_check
            install_dependencies
            run_tests
            build_production
            deploy_to_render
            ;;
        3)
            check_env_vars
            deploy_docker
            ;;
        4)
            check_env_vars
            health_check
            ;;
        5)
            echo "👋 Goodbye!"
            exit 0
            ;;
        *)
            echo "❌ Invalid option"
            show_menu
            ;;
    esac
}

# Check if running with arguments
if [ $# -eq 0 ]; then
    show_menu
else
    case $1 in
        "local")
            setup_local
            ;;
        "render")
            check_env_vars
            health_check
            deploy_to_render
            ;;
        "docker")
            check_env_vars
            deploy_docker
            ;;
        "health")
            check_env_vars
            health_check
            ;;
        *)
            echo "Usage: $0 [local|render|docker|health]"
            exit 1
            ;;
    esac
fi
