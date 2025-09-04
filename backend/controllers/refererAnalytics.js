const asyncHandler = require('express-async-handler');
const { getRefererStats, getRefererDataByDateRange } = require('../utils/refererAnalytics');

/**
 * @desc    Get referer analytics statistics
 * @route   GET /api/analytics/referer-stats
 * @access  Private (Admin only)
 */
const getRefererAnalytics = asyncHandler(async (req, res) => {
    // Check if user is admin
    if (!req.user || req.user.id !== process.env.ADMIN_USER_ID) {
        res.status(403);
        throw new Error('Access denied. Admin privileges required.');
    }

    try {
        const days = parseInt(req.query.days) || 30;
        const stats = await getRefererStats(days);
        
        res.status(200).json({
            success: true,
            data: stats,
            message: `Referer analytics for the last ${days} days`
        });
    } catch (error) {
        console.error('Error fetching referer analytics:', error);
        res.status(500);
        throw new Error('Failed to fetch referer analytics');
    }
});

/**
 * @desc    Get detailed referer data for date range
 * @route   GET /api/analytics/referer-data
 * @access  Private (Admin only)
 */
const getRefererData = asyncHandler(async (req, res) => {
    // Check if user is admin
    if (!req.user || req.user.id !== process.env.ADMIN_USER_ID) {
        res.status(403);
        throw new Error('Access denied. Admin privileges required.');
    }

    try {
        const { startDate, endDate } = req.query;
        
        if (!startDate || !endDate) {
            res.status(400);
            throw new Error('Both startDate and endDate are required');
        }

        const data = await getRefererDataByDateRange(startDate, endDate);
        
        res.status(200).json({
            success: true,
            data: data,
            count: data.length,
            dateRange: { startDate, endDate }
        });
    } catch (error) {
        console.error('Error fetching referer data:', error);
        res.status(500);
        throw new Error('Failed to fetch referer data');
    }
});

/**
 * @desc    Get referer summary for dashboard
 * @route   GET /api/analytics/referer-summary
 * @access  Private (Admin only)
 */
const getRefererSummary = asyncHandler(async (req, res) => {
    // Check if user is admin
    if (!req.user || req.user.id !== process.env.ADMIN_USER_ID) {
        res.status(403);
        throw new Error('Access denied. Admin privileges required.');
    }

    try {
        const stats = await getRefererStats(7); // Last 7 days for summary
        
        const summary = {
            totalVisits: stats.totalVisits,
            directVisits: stats.directVisits,
            searchEngineVisits: stats.searchEngineVisits,
            socialMediaVisits: stats.socialMediaVisits,
            externalVisits: stats.externalVisits,
            internalVisits: stats.internalVisits,
            topCategory: Object.entries(stats.categories)
                .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none',
            topReferer: Object.entries(stats.topReferers)
                .sort(([,a], [,b]) => b - a)[0]?.[0] || 'none'
        };
        
        res.status(200).json({
            success: true,
            data: summary,
            period: 'Last 7 days'
        });
    } catch (error) {
        console.error('Error fetching referer summary:', error);
        res.status(500);
        throw new Error('Failed to fetch referer summary');
    }
});

module.exports = {
    getRefererAnalytics,
    getRefererData,
    getRefererSummary
};
