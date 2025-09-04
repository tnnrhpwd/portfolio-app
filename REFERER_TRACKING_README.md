# HTTP Referer Tracking Implementation

This implementation adds comprehensive HTTP referer tracking to your existing IP checking and database logging system.

## 🎯 Features Added

### 1. Enhanced `checkIP` Function
- **Referer URL Parsing**: Extracts and validates referer URLs
- **Host & Path Analysis**: Separates hostname and path for better analytics
- **Query Parameter Tracking**: Captures search terms and URL parameters
- **Referer Categorization**: Automatically categorizes traffic sources
- **Error Handling**: Gracefully handles malformed URLs

### 2. Referer Categories
- `direct` - No referer (bookmarks, direct URL entry)
- `internal` - Same-domain navigation
- `search_google` - Google search results
- `search_bing` - Bing search results
- `search_yahoo` - Yahoo search results
- `social_facebook` - Facebook referrals
- `social_twitter` - Twitter referrals
- `social_linkedin` - LinkedIn referrals
- `development_github` - GitHub referrals
- `external` - Other external websites
- `malformed` - Invalid referer URLs

### 3. Analytics API Endpoints
- `GET /api/data/analytics/referer-stats` - Comprehensive statistics
- `GET /api/data/analytics/referer-data` - Detailed data by date range
- `GET /api/data/analytics/referer-summary` - Dashboard summary

## 📊 Data Format

### Database Entry Example
```
IP:203.0.113.1|User:user123|Device:Desktop|OS:Windows 10|Browser:Chrome 91.0.4472.124|Method:GET|URL:/portfolio|Referer:https://www.google.com/search?q=portfolio+website|RefererHost:www.google.com|RefererPath:/search|RefererQuery:?q=portfolio+website|RefererCategory:search_google|Platform:win32|City:New York|Region:NY|Country:US
```

### Analytics Response Example
```json
{
  "success": true,
  "data": {
    "totalVisits": 1250,
    "dateRange": {
      "from": "2025-08-05T00:00:00.000Z",
      "to": "2025-09-04T00:00:00.000Z"
    },
    "categories": {
      "direct": 450,
      "search_google": 320,
      "social_facebook": 180,
      "external": 150,
      "internal": 100,
      "search_bing": 50
    },
    "directVisits": 450,
    "searchEngineVisits": 370,
    "socialMediaVisits": 180,
    "externalVisits": 150,
    "internalVisits": 100,
    "topReferers": {
      "https://www.google.com/search?q=portfolio": 245,
      "https://www.facebook.com/": 180,
      "https://github.com/": 75
    },
    "searchQueries": [
      {
        "terms": "portfolio website",
        "engine": "search_google",
        "timestamp": "2025-09-04T10:30:00.000Z"
      }
    ]
  }
}
```

## 🚀 Usage

### 1. Automatic Tracking
The referer tracking is automatically enabled for all requests that go through the `checkIP` function. No additional code changes needed in your existing controllers.

### 2. Analytics Access (Admin Only)

#### Get 30-day Statistics
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://yoursite.com/api/data/analytics/referer-stats?days=30"
```

#### Get Custom Date Range Data
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://yoursite.com/api/data/analytics/referer-data?startDate=2025-09-01T00:00:00.000Z&endDate=2025-09-04T23:59:59.999Z"
```

#### Get Dashboard Summary
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
     "https://yoursite.com/api/data/analytics/referer-summary"
```

### 3. Programmatic Access

```javascript
const { getRefererStats, parseRefererFromLog } = require('./utils/refererAnalytics');

// Get analytics for last 7 days
const stats = await getRefererStats(7);

// Parse referer from existing log entry
const logText = "IP:203.0.113.1|Referer:https://google.com|RefererHost:google.com...";
const refererInfo = parseRefererFromLog(logText);
```

## 🔧 Configuration

### Environment Variables
No additional environment variables needed. Uses existing DynamoDB configuration.

### Admin Access
Only users with `req.user.id === process.env.ADMIN_USER_ID` can access analytics endpoints.

## 🧪 Testing

Run the test script to verify functionality:
```bash
node test-referer-tracking.js
```

## 📈 Analytics Insights

### Traffic Source Analysis
- **Direct Traffic**: Users who bookmarked your site or typed URL directly
- **Search Engine Traffic**: Organic search results and paid ads
- **Social Media Traffic**: Referrals from social platforms
- **Referral Traffic**: Links from other websites
- **Internal Navigation**: User browsing within your site

### Search Query Analysis
- Extract and analyze search terms that brought users to your site
- Identify popular keywords and content interests
- Track search engine performance (Google vs Bing vs others)

### User Journey Tracking
- Understand how users navigate through your site
- Identify popular entry points and content paths
- Analyze user behavior patterns

## 🔒 Privacy & Security

### Data Protection
- Only stores referer URLs, not sensitive user data
- Admin-only access to analytics data
- Rate limiting on analytics endpoints

### GDPR Compliance
- Consider implementing user consent for analytics tracking
- Provide data deletion capabilities if required
- Document data retention policies

## 🛠️ Customization

### Adding New Categories
Edit the categorization logic in `accessData.js`:

```javascript
// Add new category detection
else if (refererUrl.hostname.includes('reddit.')) {
    refererCategory = 'social_reddit';
}
```

### Custom Analytics
Extend `refererAnalytics.js` to add new metrics:

```javascript
// Add conversion tracking
stats.conversions = refererData.filter(data => 
    data.url && data.url.includes('/purchase')
).length;
```

## 📝 Maintenance

### Database Cleanup
Consider implementing periodic cleanup of old access logs:

```javascript
// Delete logs older than 1 year
const cutoffDate = new Date();
cutoffDate.setFullYear(cutoffDate.getFullYear() - 1);
```

### Performance Optimization
For high-traffic sites, consider:
- Implementing data aggregation
- Using time-based partitioning
- Caching frequent analytics queries

## 🆘 Troubleshooting

### Common Issues

1. **No referer data**: Some browsers/extensions block referer headers
2. **Localhost testing**: Modify `checkIP` to allow localhost IPs for testing
3. **Analytics access denied**: Ensure user has admin privileges
4. **Missing categories**: Add new detection logic for specific sites

### Debug Mode
Enable detailed logging by uncommenting console.log statements in `accessData.js`.
