.PHONY: dev reset install-postgres test-db init release release-major release-minor release-patch

# Initialize project and database
init:
	@echo "🚀 Initializing project..." && \
	# Check for required tools
	if ! command -v psql &> /dev/null; then \
		echo "❌ Error: psql command not found" && \
		echo "PostgreSQL is required for database operations." && \
		echo "Please install it with: brew install postgresql@14" && \
		echo "After installation, run: brew services start postgresql@14" && \
		exit 1; \
	fi && \
	if ! command -v jq &> /dev/null; then \
		echo "❌ Error: jq command not found" && \
		echo "jq is required for password encoding." && \
		echo "Please install it with: brew install jq" && \
		exit 1; \
	fi && \
	if ! command -v timeout &> /dev/null; then \
		echo "❌ Error: timeout command not found" && \
		echo "timeout is required for connection timeouts." && \
		echo "Please install it with: brew install coreutils" && \
		exit 1; \
	fi && \
	# Check for .env file
	if [ ! -f .env ]; then \
		echo "❌ Error: .env file not found" && \
		echo "Please create a .env file based on .env.test with your Supabase credentials" && \
		exit 1; \
	fi && \
	export $$(grep -v '^#' .env | xargs) && \
	if [ -z "$$SUPABASE_URL" ]; then \
		echo "❌ Error: SUPABASE_URL is not set in .env" && \
		echo "Please add your Supabase project URL to the .env file" && \
		exit 1; \
	fi && \
	if [ -z "$$SUPABASE_DB_PASSWORD" ]; then \
		echo "❌ Error: SUPABASE_DB_PASSWORD is not set in .env" && \
		echo "Please add your Supabase database password to the .env file" && \
		exit 1; \
	fi && \
	echo "✅ Environment variables verified" && \
	echo "Testing database connection..." && \
	PROJECT_REF=$$(echo $$SUPABASE_URL | sed -E 's|https://([^.]+)\..*|\1|') && \
	DB_HOST="aws-0-eu-central-1.pooler.supabase.com" && \
	DB_PORT="6543" && \
	ENCODED_PASSWORD=$$(printf '%s' "$$SUPABASE_DB_PASSWORD" | jq -sRr @uri) && \
	DB_URL="postgresql://postgres.$$PROJECT_REF:$$ENCODED_PASSWORD@$$DB_HOST:$$DB_PORT/postgres?sslmode=require" && \
	timeout 10s psql "$$DB_URL" -c "SELECT version();" && { \
		echo "✅ Database connection successful" && \
		echo "Setting up database..." && \
		timeout 30s psql "$$DB_URL" -f sql/setup.sql && { \
			echo "✅ Database setup completed successfully!" && \
			echo "" && \
			echo "🎉 Project initialization complete!" && \
			echo "You can now use the following commands:" && \
			echo "  - make dev     : Start the development server" && \
			echo "  - make test-db : Test the database connection" && \
			echo "  - make reset   : Reset the database" && \
		} || { \
			echo "❌ Error: Database setup failed" && \
			echo "Please check the error message above and try again" && \
			exit 1; \
		}; \
	} || { \
		if [ $$? -eq 124 ]; then \
			echo "❌ Error: Connection timed out after 10 seconds" && \
			echo "This is likely because your IP address is not allowed in Supabase's network settings." && \
			echo "" && \
			echo "Your current IP address: $$(curl -s https://api.ipify.org)" && \
			echo "" && \
			echo "To fix this:" && \
			echo "1. Go to your Supabase dashboard" && \
			echo "2. Navigate to Project Settings > Database" && \
			echo "3. Under 'Network Restrictions', add the IP address shown above" && \
			echo "4. Wait a few minutes for the changes to take effect" && \
			echo "5. Try running 'make init' again" && \
		else \
			echo "❌ Error: Database connection failed" && \
			echo "Connection details:" && \
			echo "  Host: $$DB_HOST" && \
			echo "  Port: $$DB_PORT" && \
			echo "  Project Reference: $$PROJECT_REF" && \
			echo "" && \
			echo "Troubleshooting steps:" && \
			echo "1. Check if the hostname is correct: $$DB_HOST" && \
			echo "2. Verify the project reference matches your Supabase dashboard" && \
			echo "3. Check if there are any network restrictions or firewall rules" && \
			echo "4. Try using the exact connection string from your Supabase dashboard" && \
		fi; \
		exit 1; \
	}

# Development command
dev:
	yarn dev

# Install PostgreSQL
install-postgres:
	@if ! command -v psql &> /dev/null; then \
		echo "Installing PostgreSQL..." && \
		brew install postgresql@14 && \
		echo "PostgreSQL installed. Please run 'brew services start postgresql@14' to start the service."; \
	else \
		echo "PostgreSQL is already installed."; \
	fi

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
		echo "Please create a .env file based on .env.test"; \
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
		echo "Error: .env file not found. Please create one based on .env.test"; \
		exit 1; \
	fi

# Release workflow

# Source the release utilities
include scripts/release-utils.sh

# Release targets
release: release-patch

release-major:
	@echo "🚀 Starting major release workflow..."
	@source scripts/release-utils.sh && \
	check_working_directory && \
	check_branch && \
	current_version=$$(get_current_version) && \
	new_version=$$(bump_version $$current_version major) && \
	generate_changelog && \
	create_tag $$new_version && \
	echo "✅ Major release v$$new_version completed successfully!"

release-minor:
	@echo "🚀 Starting minor release workflow..."
	@source scripts/release-utils.sh && \
	check_working_directory && \
	check_branch && \
	current_version=$$(get_current_version) && \
	new_version=$$(bump_version $$current_version minor) && \
	generate_changelog && \
	create_tag $$new_version && \
	echo "✅ Minor release v$$new_version completed successfully!"

release-patch:
	@echo "🚀 Starting patch release workflow..."
	@source scripts/release-utils.sh && \
	check_working_directory && \
	check_branch && \
	current_version=$$(get_current_version) && \
	new_version=$$(bump_version $$current_version patch) && \
	generate_changelog && \
	create_tag $$new_version && \
	echo "✅ Patch release v$$new_version completed successfully!" 