/**
 *  Copyright (c) 2018-2021 AndreaSonny <andreasonny83@gmail.com> (https://github.com/andreasonny83)
 *
 * This software is released under the MIT License.
 * https://opensource.org/licenses/MIT
 */

const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');
const ReportGenerator = require('lighthouse/report/generator/report-generator');
const chalk = require('chalk');
const { createDefaultConfig, getOwnProps, convertToBudgetList, convertToResourceKey } = require('./helpers.js');

const readFile = promisify(fs.readFile);

const launchChromeAndRunLighthouse = async (url, chromeFlags, lighthouseFlags, configPath, budgetPath) => {
  const chrome = await chromeLauncher.launch({
    chromeFlags,
  });
  const flags = {
    port: chrome.port,
    output: 'json',
    ...lighthouseFlags,
  };
  let config;

  if (flags.extraHeaders) {
    let extraHeadersString = flags.extraHeaders;
    if (extraHeadersString.slice(0, 1) !== '{') {
      extraHeadersString = await readFile(extraHeadersString, 'UTF-8');
    }

    flags.extraHeaders = JSON.parse(extraHeadersString);
  }

  if (configPath) {
    try {
      const configJson = await readFile(path.resolve(configPath), 'UTF-8');
      config = JSON.parse(configJson);
    } catch (error) {
      throw new Error(error.message);
    }
  }

  if (budgetPath) {
    try {
      const budgetJson = await readFile(path.resolve(budgetPath), 'UTF-8');

      config = createDefaultConfig(config);

      config.settings.budgets = JSON.parse(budgetJson);
    } catch (error) {
      throw new Error(error.message);
    }
  } else if (flags && flags.budget) {
    config = createDefaultConfig(config);

    const { budget } = flags;

    const budgetConfigs = getOwnProps(budget)
      .filter((key) => budget[key] && (key === 'counts' || key === 'sizes'))
      .reduce(
        (acc, key) => {
          acc[convertToResourceKey(key)] = convertToBudgetList(budget[key]);
          return acc;
        },
        {
          resourceSizes: [],
          resourceCounts: [],
        },
      );

    config.settings.budgets = [budgetConfigs];
  }

  const result = await lighthouse(url, flags, config);
  await chrome.kill();

  if (!result || !result.lhr) {
    throw new Error('Something went wrong when running Lighthouse against the given url');
  }

  if (result.lhr.runtimeError) {
    throw new Error(result.lhr.runtimeError.message);
  }

  if (result.lhr.runWarnings.length > 0) {
    for (const warningMessage of result.lhr.runWarnings) {
      console.warn(`\n${chalk.yellow('WARNING:')} ${warningMessage}`);
    }

    console.warn('\n');
  }

  return result;
};

const createHtmlReport = (results, flags) => {
  if (flags.report) {
    return ReportGenerator.generateReportHtml(results);
  }

  return null;
};

const createJsonReport = (results, flags) => {
  if (flags.report && flags.jsonReport) {
    return ReportGenerator.generateReport(results, 'json');
  }

  return null;
};

const createCategoryReport = (results) => {
  const { categories } = results;

  return getOwnProps(categories).reduce((categoryReport, categoryName) => {
    const category = results.categories[categoryName];
    categoryReport[category.id] = Math.round(category.score * 100);
    return categoryReport;
  }, {});
};

const createBudgetsReport = (results) => {
  const items =
    (results.audits &&
      results.audits['performance-budget'] &&
      results.audits['performance-budget'].details &&
      results.audits['performance-budget'].details.items) ||
    [];

  const timings =
    (results.audits &&
      results.audits['timing-budget'] &&
      results.audits['timing-budget'].details &&
      results.audits['timing-budget'].details.items) ||
    [];

  const report = items.reduce((acc, object) => {
    if (object.countOverBudget) {
      acc[object.resourceType + '-count'] = `${object.countOverBudget}`;
    }

    if (object.sizeOverBudget) {
      acc[object.resourceType + '-size'] = `${Math.round(object.sizeOverBudget / 1024, 0)}kb`;
    }

    return acc;
  }, {});

  const timingReport = timings.reduce((acc, { overBudget, metric }) => {
    if (overBudget && typeof overBudget === 'object') {
      const { value } = overBudget;
      if (value && typeof value === 'number') {
        acc[metric] = value;
      }
    }

    if (overBudget && typeof overBudget === 'number') {
      acc[metric] = `${overBudget}ms`;
    }

    return acc;
  }, {});

  return { ...report, ...timingReport };
};

async function writeReport(url, flags = {}, defaultChromeFlags = [], lighthouseFlags = {}) {
  const { chromeFlags, configPath, budgetPath, ...extraLHFlags } = lighthouseFlags;
  const customChromeFlags = chromeFlags ? chromeFlags.split(',') : [];

  const lighthouseResult = await launchChromeAndRunLighthouse(
    url,
    [...defaultChromeFlags, ...customChromeFlags],
    extraLHFlags,
    configPath,
    budgetPath,
  );

  const htmlReport = createHtmlReport(lighthouseResult.lhr, flags);
  const jsonReport = createJsonReport(lighthouseResult.lhr, flags);

  const categoryReport = createCategoryReport(lighthouseResult.lhr);
  const budgetsReport = createBudgetsReport(lighthouseResult.lhr);

  return { categoryReport, budgetsReport, htmlReport, jsonReport };
}

module.exports = writeReport;
