#!/bin/bash

# Colors for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if working directory is clean
check_working_directory() {
    if [ -n "$(git status --porcelain)" ]; then
        log_error "Working directory is not clean. Please commit or stash changes."
        git status
        exit 1
    fi
    log_success "Working directory is clean"
}

# Check if we're on main branch
check_branch() {
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [ "$current_branch" != "main" ]; then
        log_error "Not on main branch. Current branch: $current_branch"
        exit 1
    fi
    log_success "On main branch"
}

# Get current version from manifest.json
get_current_version() {
    if [ -f manifest.json ]; then
        version=$(grep '"version":' manifest.json | cut -d\" -f4)
        echo "$version"
    else
        log_error "manifest.json not found"
        exit 1
    fi
}

# Bump version in manifest.json and package.json
bump_version() {
    current_version=$1
    bump_type=$2

    # Parse current version
    IFS='.' read -r major minor patch <<< "$current_version"

    case $bump_type in
        "major")
            new_version="$((major + 1)).0.0"
            ;;
        "minor")
            new_version="$major.$((minor + 1)).0"
            ;;
        "patch")
            new_version="$major.$minor.$((patch + 1))"
            ;;
        *)
            log_error "Invalid bump type: $bump_type. Use major, minor, or patch"
            exit 1
            ;;
    esac

    # Update manifest.json
    sed -i '' "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" manifest.json
    log_info "Updated version in manifest.json to $new_version"

    # Update package.json if it exists
    if [ -f package.json ]; then
        sed -i '' "s/\"version\": \"$current_version\"/\"version\": \"$new_version\"/" package.json
        log_info "Updated version in package.json to $new_version"
    fi

    echo "$new_version"
}

# Generate changelog from git commits
generate_changelog() {
    last_tag=$(git describe --tags --abbrev=0 2>/dev/null)
    if [ -z "$last_tag" ]; then
        log_warning "No previous tag found. Using all commits."
        git log --pretty=format:"- %s" > CHANGELOG.md
    else
        log_info "Generating changelog since last tag: $last_tag"
        git log --pretty=format:"- %s" "$last_tag"..HEAD > CHANGELOG.md
    fi

    # Add header to changelog
    echo -e "# Changelog\n\n## $(get_current_version) ($(date +%Y-%m-%d))\n" > temp_changelog.md
    cat CHANGELOG.md >> temp_changelog.md
    mv temp_changelog.md CHANGELOG.md

    log_success "Generated changelog"
}

# Create git tag and push
create_tag() {
    version=$1
    git add manifest.json package.json CHANGELOG.md
    git commit -m "Bump version to $version"
    git tag -a "v$version" -m "Release v$version"
    git push origin main
    git push origin "v$version"
    log_success "Created and pushed tag v$version"
}

# Run tests (placeholder)
run_tests() {
    log_info "Running tests..."
    # TODO: Implement actual tests
    log_success "All tests passed (placeholder)"
} 