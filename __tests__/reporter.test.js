const writeReport = require('../lib/lighthouse-reporter.js');

describe('Reporter', () => {
  jest.setTimeout(20000); // Allows more time to run all tests

  it('should launch Chrome and generate a report', async () => {
    const result = await writeReport('http://example.com/');
    expect(result).toEqual(
      expect.objectContaining({
        categoryReport: {
          performance: expect.any(Number),
          accessibility: expect.any(Number),
          'best-practices': expect.any(Number),
          seo: expect.any(Number),
          pwa: expect.any(Number),
        },
        budgetsReport: expect.any(Object),
        htmlReport: expect.any(Object),
        jsonReport: expect.any(Object),
      }),
    );
  });
});
