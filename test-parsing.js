const { parseUsageData } = require('./backend/utils/apiUsageTracker');

console.log('Testing parseUsageData function...');

const testUserText = 'Nickname:tnnrhpwd|Email:tnnrhpwd@gmail.com|Password:$2a$10$QOEn9MNg.JOI1xrdp6mEmOFvqc/4dsg7GHmGnC2PYGtjxx577Cs9K|Birth:2023-12-28T17:59:22.471Z|stripeid:cus_RsVtxVSr3nXacR|Usage:openai-2025-08-30:1664t:$0.0196';

console.log('Input user text:');
console.log(testUserText);
console.log('\n--- Testing parseUsageData ---');

const result = parseUsageData(testUserText);
console.log('Parsed result:');
console.log(JSON.stringify(result, null, 2));
