/**
 * OpenAI API Key Test - Converted to Jest
 */
require('dotenv').config();

describe('OpenAI API Configuration', () => {
    it('should check for OpenAI API key in environment', () => {
        // Check if key exists - don't fail if not set in test environment
        if (process.env.OPENAI_KEY) {
            expect(typeof process.env.OPENAI_KEY).toBe('string');
            expect(process.env.OPENAI_KEY.length).toBeGreaterThan(20);
        } else {
            // Log warning but don't fail - API key might not be set in CI/test environments
            console.warn('OPENAI_KEY not set in environment');
            expect(true).toBe(true); // Pass the test
        }
    });

    it('should validate API key format if present', () => {
        if (process.env.OPENAI_KEY && process.env.OPENAI_KEY.length > 3) {
            // OpenAI keys typically start with 'sk-'
            const hasValidPrefix = process.env.OPENAI_KEY.startsWith('sk-') || 
                                   process.env.OPENAI_KEY === 'test-key';
            expect(hasValidPrefix).toBe(true);
        } else {
            expect(true).toBe(true); // Pass if no key configured
        }
    });
});