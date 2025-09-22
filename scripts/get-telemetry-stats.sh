#!/bin/bash

# Simple script to check telemetry endpoints
# For Jaxon Digital MCP Telemetry

echo "🔍 Checking Jaxon Digital MCP Telemetry Endpoints"
echo "=================================================="
echo

# Base URL
BASE_URL="https://accelerator.jaxondigital.com/api/telemetry"

# Check health endpoint
echo "1️⃣ Health Check:"
echo "   GET $BASE_URL/health"
HEALTH=$(curl -s "$BASE_URL/health")
if [ $? -eq 0 ]; then
    echo "   Response: $HEALTH"
    echo "   ✅ Health endpoint is working"
else
    echo "   ❌ Health endpoint failed"
fi
echo

# Check stats endpoint  
echo "2️⃣ Stats Endpoint:"
echo "   GET $BASE_URL/stats"
STATS=$(curl -s "$BASE_URL/stats")
if [ $? -eq 0 ]; then
    echo "   Response: $STATS"
    echo "   ✅ Stats endpoint is working"
else
    echo "   ❌ Stats endpoint failed"
fi
echo

# Try the new aggregated stats endpoint (may not be deployed yet)
echo "3️⃣ Aggregated Stats (New - May Not Be Deployed):"
echo "   GET $BASE_URL/aggregated-stats"
AGG_STATS=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL/aggregated-stats")
HTTP_STATUS=$(echo "$AGG_STATS" | grep "HTTP_STATUS" | cut -d: -f2)
RESPONSE=$(echo "$AGG_STATS" | grep -v "HTTP_STATUS")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "   ✅ Aggregated stats endpoint is working!"
    echo "   Response:"
    echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
elif [ "$HTTP_STATUS" = "404" ]; then
    echo "   ⚠️  Aggregated stats endpoint not deployed yet (404)"
    echo "   This endpoint needs to be deployed to production"
else
    echo "   ❌ Unexpected response (HTTP $HTTP_STATUS)"
fi
echo

# Try to get raw data for today
echo "4️⃣ Raw Data for Today:"
TODAY=$(date +%Y-%m-%d)
echo "   GET $BASE_URL/raw/$TODAY"
RAW_DATA=$(curl -s -w "\nHTTP_STATUS:%{http_code}" "$BASE_URL/raw/$TODAY")
HTTP_STATUS=$(echo "$RAW_DATA" | grep "HTTP_STATUS" | cut -d: -f2)
RESPONSE=$(echo "$RAW_DATA" | grep -v "HTTP_STATUS")

if [ "$HTTP_STATUS" = "200" ]; then
    echo "   ✅ Raw data endpoint is working!"
    # Show just a summary since raw data can be large
    echo "$RESPONSE" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(f'   Date: {data.get(\"Date\", \"N/A\")}')
    print(f'   Entry Count: {data.get(\"EntryCount\", 0)}')
except:
    print('   Could not parse response')
" 2>/dev/null
elif [ "$HTTP_STATUS" = "404" ]; then
    echo "   ⚠️  No telemetry data for today or endpoint not deployed"
else
    echo "   ❌ Unexpected response (HTTP $HTTP_STATUS)"
fi
echo

echo "=================================================="
echo "📊 Summary:"
echo
echo "The telemetry system is collecting data at:"
echo "  POST $BASE_URL/mcp"
echo
echo "Currently available endpoints:"
echo "  ✅ GET $BASE_URL/health - Service health check"
echo "  ✅ GET $BASE_URL/stats - Basic statistics (file-based)"
echo
echo "New endpoints (need deployment):"
echo "  🚀 GET $BASE_URL/aggregated-stats - Aggregated analytics"
echo "  🚀 GET $BASE_URL/raw/{date} - Raw data for specific date"
echo
echo "To deploy the new endpoints:"
echo "1. Push TelemetryStatsController.cs to the OCA project"
echo "2. Deploy to Azure App Service"
echo "3. The endpoints will then provide detailed analytics"
echo