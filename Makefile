.PHONY: dev reset install-postgres test-db init release release-major release-minor release-patch \
	install-node install-yarn install-jq install-timeout check-env setup-db

# Development commands
dev:
@if ! command -v node &> /dev/null; then \
echo "❌ Error: Node.js is not installed" && \
echo "Please run 'make install-node' to install Node.js" && \
exit 1; \
fi && \
NODE_VERSION=$$(node -v | sed 's/v//') && \
NODE_MAJOR=$${NODE_VERSION%%.*} && \
if [ $$NODE_MAJOR -lt 18 ]; then \
echo "❌ Error: Node.js 18+ is required (found $$NODE_VERSION)" && \
echo "Please upgrade Node.js before running development commands" && \
exit 1; \
fi && \
if ! command -v yarn &> /dev/null; then \
echo "❌ Error: Yarn is not installed" && \
echo "Please run 'make install-yarn' to install Yarn" && \
exit 1; \
fi && \
	yarn dev

# Install Node.js
install-node:
	@if ! command -v node &> /dev/null; then \
		echo "Installing Node.js..." && \
		echo "Please choose an installation method:" && \
		echo "1. Using nvm (recommended):" && \
		echo "   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash" && \
		echo "   nvm install 18" && \
		echo "2. Using Homebrew:" && \
		echo "   brew install node@18" && \
		echo "   brew link node@18" && \
		exit 1; \
	else \
		echo "✅ Node.js is already installed"; \
	fi

# Install Yarn
install-yarn:
	@if ! command -v yarn &> /dev/null; then \
		echo "Installing Yarn..." && \
		echo "Please run: npm install -g yarn" && \
		exit 1; \
	else \
		echo "✅ Yarn is already installed"; \
	fi

# Install PostgreSQL
install-postgres:
	@if ! command -v psql &> /dev/null; then \
		echo "Installing PostgreSQL..." && \
		brew install postgresql@14 && \
		echo "PostgreSQL installed. Please run 'brew services start postgresql@14' to start the service."; \
	else \
		echo "✅ PostgreSQL is already installed."; \
	fi

# Install jq
install-jq:
	@if ! command -v jq &> /dev/null; then \
		echo "Installing jq..." && \
		brew install jq && \
		echo "✅ jq installed successfully"; \
	else \
		echo "✅ jq is already installed"; \
	fi

# Install timeout (coreutils)
install-timeout:
	@if ! command -v timeout &> /dev/null; then \
		echo "Installing coreutils (for timeout command)..." && \
		brew install coreutils && \
		echo "✅ coreutils installed successfully"; \
	else \
		echo "✅ timeout command is already available"; \
	fi

# Check environment setup
check-env:
@if [ ! -f .env ]; then \
echo "📝 Creating .env file from template..." && \
cp .env.template .env && \
echo "✅ .env file created. Please update the values in .env" && \
exit 0; \
fi && \
	export $$(grep -v '^#' .env | xargs) && \
	if [ -z "$$SUPABASE_URL" ] || [ -z "$$SUPABASE_DB_PASSWORD" ]; then \
		echo "❌ Error: SUPABASE_URL or SUPABASE_DB_PASSWORD not set in .env" && \
		echo "Please update the values in .env" && \
		exit 1; \
	else \
		echo "✅ Environment variables are properly set"; \
	fi

# Setup database
setup-db:
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | xargs) && \
		# Test database connection
		echo "🔍 Testing database connection..." && \
		PROJECT_REF=$$(echo $$SUPABASE_URL | sed -E 's|https://([^.]+)\..*|\1|') && \
		DB_HOST="aws-0-eu-central-1.pooler.supabase.com" && \
		DB_PORT="6543" && \
		ENCODED_PASSWORD=$$(printf '%s' "$$SUPABASE_DB_PASSWORD" | jq -sRr @uri) && \
		DB_URL="postgresql://postgres.$$PROJECT_REF:$$ENCODED_PASSWORD@$$DB_HOST:$$DB_PORT/postgres?sslmode=require" && \
		if ! timeout 10s psql "$$DB_URL" -c "SELECT 1" > /dev/null 2>&1; then \
			echo "❌ Error: Could not connect to database" && \
			echo "Please check your Supabase credentials and network connection" && \
			exit 1; \
		fi && \
		# Run database setup
		echo "📦 Setting up database..." && \
		timeout 30s psql "$$DB_URL" -f sql/setup.sql && \
		echo "✅ Database setup complete!"; \
else \
echo "❌ Error: .env file not found" && \
echo "Please run 'make check-env' first (uses .env.template)" && \
exit 1; \
fi

# Initialize project and database
init: install-node install-yarn install-postgres install-jq install-timeout check-env
	@echo "📦 Installing project dependencies..." && \
	yarn install && \
	make setup-db && \
	echo "🎉 Project initialized successfully!" && \
	echo "" && \
	echo "Next steps:" && \
	echo "1. Run 'make dev' to start the development server" && \
	echo "2. Open Obsidian and enable the plugin" && \
	echo "3. Configure the plugin with your Supabase credentials" && \
	echo "" && \
	echo "Available commands:" && \
	echo "  - make dev        : Start the development server" && \
	echo "  - make test-db    : Test the database connection" && \
	echo "  - make reset      : Reset the database" && \
	echo "  - make release    : Create a new release"

# Test database connection
test-db:
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | xargs) && \
		if [ -z "$$SUPABASE_DB_PASSWORD" ]; then \
			echo "Error: SUPABASE_DB_PASSWORD is not set in .env"; \
			exit 1; \
		fi && \
		PROJECT_REF=$$(echo $$SUPABASE_URL | sed -E 's|https://([^.]+)\..*|\1|') && \
		DB_HOST="aws-0-eu-central-1.pooler.supabase.com" && \
		DB_PORT="6543" && \
		ENCODED_PASSWORD=$$(printf '%s' "$$SUPABASE_DB_PASSWORD" | jq -sRr @uri) && \
		DB_URL="postgresql://postgres.$$PROJECT_REF:$$ENCODED_PASSWORD@$$DB_HOST:$$DB_PORT/postgres?sslmode=require" && \
		echo "Testing database connection..." && \
		timeout 10s psql "$$DB_URL" -c "SELECT version();" && { \
			echo "✅ Database connection successful!"; \
			echo "You can now use the database commands:"; \
			echo "  - make reset    : Reset and set up the database"; \
			echo "  - make test-db  : Test the connection again"; \
		} || { \
			if [ $$? -eq 124 ]; then \
				echo "❌ Error: Connection timed out after 10 seconds"; \
				echo "This is likely because your IP address is not allowed in Supabase's network settings."; \
				echo ""; \
				echo "Your current IP address: $$(curl -s https://api.ipify.org)" && \
				echo ""; \
				echo "To fix this:"; \
				echo "1. Go to your Supabase dashboard"; \
				echo "2. Navigate to Project Settings > Database"; \
				echo "3. Under 'Network Restrictions', add the IP address shown above"; \
				echo "4. Wait a few minutes for the changes to take effect"; \
				echo "5. Try running this command again"; \
			else \
				echo "❌ Error: Database connection failed"; \
				echo "Connection details:"; \
				echo "  Host: $$DB_HOST"; \
				echo "  Port: $$DB_PORT"; \
				echo "  Project Reference: $$PROJECT_REF"; \
				echo ""; \
				echo "Troubleshooting steps:"; \
				echo "1. Check if the hostname is correct: $$DB_HOST"; \
				echo "2. Verify the project reference matches your Supabase dashboard"; \
				echo "3. Check if there are any network restrictions or firewall rules"; \
				echo "4. Try using the exact connection string from your Supabase dashboard"; \
			fi; \
			exit 1; \
		}; \
else \
echo "❌ Error: .env file not found"; \
echo "Please create a .env file based on .env.template"; \
exit 1; \
fi

# Reset database command - runs reset.sql followed by setup.sql
reset:
	@if [ -f .env ]; then \
		export $$(grep -v '^#' .env | xargs) && \
		if [ -z "$$SUPABASE_DB_PASSWORD" ]; then \
			echo "Error: SUPABASE_DB_PASSWORD is not set in .env"; \
			exit 1; \
		fi && \
		PROJECT_REF=$$(echo $$SUPABASE_URL | sed -E 's|https://([^.]+)\..*|\1|') && \
		DB_HOST="aws-0-eu-central-1.pooler.supabase.com" && \
		DB_PORT="6543" && \
		ENCODED_PASSWORD=$$(printf '%s' "$$SUPABASE_DB_PASSWORD" | jq -sRr @uri) && \
		DB_URL="postgresql://postgres.$$PROJECT_REF:$$ENCODED_PASSWORD@$$DB_HOST:$$DB_PORT/postgres?sslmode=require" && \
		echo "Resetting database..." && \
		timeout 30s psql "$$DB_URL" -f sql/reset.sql || { \
			if [ $$? -eq 124 ]; then \
				echo "Error: Reset operation timed out after 30 seconds"; \
			else \
				echo "Error: Reset operation failed"; \
			fi; \
			exit 1; \
		} && \
		echo "Setting up database..." && \
		timeout 30s psql "$$DB_URL" -f sql/setup.sql || { \
			if [ $$? -eq 124 ]; then \
				echo "Error: Setup operation timed out after 30 seconds"; \
			else \
				echo "Error: Setup operation failed"; \
			fi; \
			exit 1; \
		}; \
else \
echo "Error: .env file not found. Please create one based on .env.template"; \
exit 1; \
fi

# Release targets
.PHONY: release-major release-minor release-patch

release-major:
	@echo "🚀 Starting major release process..."
	@bash -c 'source scripts/release-utils.sh && \
	export -f check_clean_working_dir check_main_branch get_current_version bump_version generate_changelog run_tests create_tag && \
	check_clean_working_dir && \
	check_main_branch && \
	get_current_version && \
	bump_version major && \
	generate_changelog && \
	run_tests && \
	create_tag && \
	echo "✅ Major release completed successfully!"'

release-minor:
	@echo "🚀 Starting minor release process..."
	@bash -c 'source scripts/release-utils.sh && \
	export -f check_clean_working_dir check_main_branch get_current_version bump_version generate_changelog run_tests create_tag && \
	check_clean_working_dir && \
	check_main_branch && \
	get_current_version && \
	bump_version minor && \
	generate_changelog && \
	run_tests && \
	create_tag && \
	echo "✅ Minor release completed successfully!"'

release-patch:
	@echo "🚀 Starting patch release process..."
	@bash -c 'source scripts/release-utils.sh && \
	export -f check_clean_working_dir check_main_branch get_current_version bump_version generate_changelog run_tests create_tag && \
	check_clean_working_dir && \
	check_main_branch && \
	get_current_version && \
	bump_version patch && \
	generate_changelog && \
	run_tests && \
	create_tag && \
	echo "✅ Patch release completed successfully!"' 