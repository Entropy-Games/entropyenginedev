#!/usr/bin/env zx

/**
 * Builds and deploys the project to entropyengine.dev
 * OPTIONS:
 * --quiet       | limited console output
 * --silent      | no console output
 * --no-tests    | Don't run tests. Cannot be combined with --prod
 * --no-frontend | Don't rebuild the HTML, CSS and JS
 * --no-backend  | Don't rebuild the node backend server
 * --no-upload   | Don't upload anything
 * --no-types    | Don't type check TS - massive speed boost
 */

// utils
const fs = require('fs');
const {sortObjectEntries} = require('./utils');
const {buildHTML} = require('./buildHTMLPath');

const p = require('path');
const chalk = require('chalk');
const performanceNow = require("performance-now");
const now = () => Math.round(performanceNow());

const
	timings = {
		'Compile TS': 0,
		'Compile LESS': 0
	},
	QUIET = process.argv.indexOf('--quiet') !== -1;

if (process.argv.indexOf('--silent') !== -1) {
	console.log = () => {}
	console.error = () => {};
}

let MAIN = '';

const TYPE_CHECKING = process.argv.indexOf('--no-types') === -1;

async function buildServer () {
	const start = now();

	await $`cd server; webpack --config webpack.config.js > log.txt`
		.catch(_ => {
			throw 'failed to build server: ' + fs.readFileSync('./server/log.txt').toString()
		});

	await $`cp ./server/index.js dist/server`;
	await $`cp ./server/index.js.map dist/server`;

	timings[`Build Node Server`] = now() - start;
}

async function upload () {
	const start = now();

	const paths = fs.readdirSync(p.resolve('./dist/'));

	for (const path of paths) {
		console.log('Uploading path ' + path);
		if (fs.statSync(p.join(p.resolve('./dist/'), path)).isDirectory()) {
			await $`sshpass -f './build/sshPass.txt' scp -r ./dist/${path} entropyengine@entropyengine.dev:~/`;
			continue;
		}
		await $`sshpass -f './build/sshPass.txt' scp ./dist/${path} entropyengine@entropyengine.dev:~/`;
	}

	console.log(chalk.green('Finished Uploading'));

	timings['Upload'] = now() - start;
}

function logTimings () {
	const namePadding = 60;
	const timePadding = 10;

	let width = namePadding + timePadding + 10;

	console.log('');
	console.log(` Timings `.padStart(width/2 + 4, '-').padEnd(width, '-'));

	const sortedTimings = sortObjectEntries(timings);

	let highlight = false;
	for (let key in sortedTimings) {
		let time = sortedTimings[key];
		let unit = 'ms';
		let decimalPlaces = 0;

		if (time > 1000) {
			time /= 1000;
			unit = 's ';
			decimalPlaces = 2;
		}

		let timeStr = chalk.yellow(time.toFixed(decimalPlaces).padStart(timePadding))
		if (highlight) {
			console.log('|' + chalk.bgBlack` ${key.padEnd(namePadding)} | ${timeStr} ${unit} ` + '|');
		} else {
			console.log(`| ${key.padEnd(namePadding)} | ${timeStr} ${unit} |`);
		}
		highlight = !highlight;
	}
	console.log(''.padStart(width, '-'))
}

async function buildWebpack () {
	const start = now();

	await $`webpack --config webpack.config.js > ./build/webpack_log.txt`
		.catch(_ => {
			console.log(chalk.red`Failed to run webpack:`,
				fs.readFileSync('build/webpack_log.txt').toString());
		});
	if (!fs.existsSync('./webpack_out.js')) {
		throw chalk.red`NO WEBPACK OUTPUT!`;
	}
	MAIN = fs.readFileSync('./webpack_out.js');
	fs.unlinkSync('./webpack_out.js');

	timings['Build WebPack'] = now() - start;
}

async function main () {

	const start = now();

	if (process.argv.indexOf('--no-frontend') === -1) {
		if (!QUIET) console.log('Building WebPack...');
		await buildWebpack().catch(handleError);

		await buildHTML('', QUIET, MAIN, timings, true, TYPE_CHECKING)
			.catch(handleError);
	}

	if (process.argv.indexOf('--no-backend') === -1) {
		if (!QUIET) console.log('Building Node Server...');
		await buildServer().catch(handleError);
	}

	if (process.argv.indexOf('--no-upload') === -1) {
		if (!QUIET) console.log('Uploading...');
		await upload().catch(handleError);
	}

	console.log(chalk.green`\nBuild Successful`);

	timings['Total'] = now() - start;

	const timingsDataFile = './build/build-data.json';
	const timingsDataJSON = JSON.parse(fs.readFileSync(timingsDataFile).toString());
	timingsDataJSON.push(timings);
	fs.writeFileSync(timingsDataFile, JSON.stringify(timingsDataJSON));

	if (!QUIET) {
		logTimings();
	}
}

function handleError (e) {
	console.log(e);
	console.log(chalk.red('\n Build Failed'));
	throw '';
}

try {
	main().catch(handleError);
} catch (e) {
	handleError(e)
}
