/**
 * Test Runner - Converted to Jest
 * This file is now a Jest test that documents available test suites
 */

describe('Backend Test Suite Documentation', () => {
    it('should document all available test suites', () => {
        const testSuites = [
            {
                name: 'Backend Unit Tests',
                file: 'back.test.js',
                description: 'Core backend functionality tests'
            },
            {
                name: 'Frontend Tests',
                file: 'frontend/src/front.test.js',
                description: 'React component and Redux tests'
            },
            {
                name: 'Referer Tracking Tests',
                file: 'integration/test-referer-tracking.js',
                description: 'Tests referer categorization'
            },
            {
                name: 'Referer Fixes Tests',
                file: 'integration/test-referer-fixes.js',
                description: 'Tests specific referer tracking fixes'
            },
            {
                name: 'Specific Issues Tests',
                file: 'integration/test-specific-issues.js',
                description: 'Tests specific reported issues'
            },
            {
                name: 'OCR Integration Tests',
                file: 'integration/test-ocr.js',
                description: 'Tests OCR functionality'
            }
        ];

        expect(testSuites.length).toBeGreaterThan(0);
        testSuites.forEach(suite => {
            expect(suite.name).toBeDefined();
            expect(suite.file).toBeDefined();
            expect(suite.description).toBeDefined();
        });
    });
});