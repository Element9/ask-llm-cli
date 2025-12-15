# requires ANTHROPIC_API_KEY env var

function ask() {
    # 1. Check for input
    if [ -z "$*" ]; then
        echo "Usage: ask <what you want to do>"
        return 1
    fi

    echo -n "⏳ Asking Claude Haiku 4.5..."

    # 2. Construct JSON Payload using jq for safety
    # We use the specific 4.5 Haiku model ID released Oct 2025
    local JSON_DATA=$(jq -n \
                  --arg prompt "You are a command line expert. Output ONLY a JSON object with two properties: 'command' (the raw terminal command) and 'safe' (boolean, true if safe, false if dangerous). Do not use markdown. Do not include code blocks. Do not explain. Request: $*" \
                  '{
                    model: "claude-haiku-4-5",
                    max_tokens: 150,
                    messages: [{role: "user", content: $prompt}]
                  }')

    # 3. Call Claude API
    local RESPONSE=$(curl -s https://api.anthropic.com/v1/messages \
        --header "x-api-key: $ANTHROPIC_API_KEY" \
        --header "anthropic-version: 2023-06-01" \
        --header "content-type: application/json" \
        --data "$JSON_DATA")

    # Clear "Asking..." status
    echo -ne "\r\033[K"

    # 4. Parse the Response
    local RESPONSE_TEXT=$(echo "$RESPONSE" | jq -r '.content[0].text // empty')

    # Error handling
    if [ -z "$RESPONSE_TEXT" ]; then
        local ERR=$(echo "$RESPONSE" | jq -r '.error.message // "Unknown error"')
        echo "❌ API Error: $ERR"
        return 1
    fi

    # Parse the command and safety flag from JSON
    local CMD=$(echo "$RESPONSE_TEXT" | jq -r '.command // empty')
    local IS_SAFE=$(echo "$RESPONSE_TEXT" | jq -r '.safe // true')

    if [ -z "$CMD" ]; then
        echo "❌ Failed to parse command from response"
        return 1
    fi

    # 5. Preview with safety warning
    if [ "$IS_SAFE" = "false" ]; then
        echo -e "⚠️  \033[1;31mWARNING: This command may be dangerous!\033[0m"
    fi
    echo -e "Command: \033[1;32m$CMD\033[0m"

    # 6. Confirm
    # Zsh uses -k 1, Bash uses -n 1
    if [ -n "$ZSH_VERSION" ]; then
        read -k 1 -r "REPLY?Execute? [y/N] "
    else
        read -n 1 -p "Execute? [y/N] " REPLY
    fi
    echo "" # New line

    # 7. Execute (Sourced)
    if [[ "$REPLY" =~ ^[Yy]$ ]]; then
        # Save to history so you can up-arrow later
        [ -n "$ZSH_VERSION" ] && print -s "$CMD"
        [ -n "$BASH_VERSION" ] && history -s "$CMD"

        # This is the magic that allows 'cd' to work
        eval "$CMD"
    else
        echo "❌ Cancelled"
    fi
}