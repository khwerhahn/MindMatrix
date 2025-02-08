#!/bin/bash

# Function to check if directory exists and contains .ts files
check_directory() {
    local dir=$1
    # Check if directory exists
    if [ ! -d "$dir" ]; then
        echo "Error: Directory '$dir' does not exist"
        return 1
    fi
    # Check if directory contains .ts files
    if [ -z "$(find "$dir" -name '*.ts' -type f)" ]; then
        echo "Error: No TypeScript files found in '$dir'"
        return 1
    fi
    return 0
}

# Main script
echo "Enter the directory to process (relative to this script):"
read directory

# Remove trailing slash if present
directory=${directory%/}

# Validate directory
while ! check_directory "$directory"; do
    echo "Please enter a valid directory that contains TypeScript files:"
    read directory
    directory=${directory%/}
done

# Process the files
for file in "$directory"/*.ts; do
    echo -e "\n### $file ###\nFilename: $(basename "$file")\n"
    cat "$file" | tr '\n' ' '
done > extract.txt

echo "Processing complete. Results saved to extract.txt"
