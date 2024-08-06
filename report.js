const fs = require('node:fs/promises');
const format = require('date-format');
const pug = require('pug');
const today = process.argv[2] ?? format.asString('dd.MM.yyyy', new Date());

(async function main() {
	const config = JSON.parse(await fs.readFile('config.json'));
	const listingDir = config.listing.dir;
	const { dir: reportDir, banned_urls: bannedUrls, crashed_urls: crashedUrls, fav_urls: favUrls, dead_urls: deadUrls, vins } = config.report;

	const report = await generateReport(today, vins, listingDir);
	console.log('Writing report json');
	await fs.mkdir(reportDir, { recursive: true });
	await fs.writeFile(`${reportDir}/${today}.json`, JSON.stringify(report, null, 2));

	const html = await createHtml(report, listingDir, { bannedUrls, crashedUrls, favUrls, deadUrls });
	console.log('Writing report html');
	await fs.writeFile(`${reportDir}/${today}.html`, html);
})();

async function generateReport(today, vins, rootDir) {
	const listingDirs = [];
	for (const filename of await fs.readdir(rootDir)) {
		const fullFilename = `${rootDir}/${filename}`;
		const stat = await fs.stat(fullFilename);
		if (stat.isDirectory() && /\d\d.\d\d.\d{4}/.test(filename)) {
			console.log(`Found listing ${filename}`);
			listingDirs.push(filename);
		}
	}
	listingDirs.sort((fname1, fname2) => {
		const date1 = format.parse('dd.MM.yyyy', fname1);
		const date2 = format.parse('dd.MM.yyyy', fname2);
		
		return date1.getTime() - date2.getTime();
	});

	const report = {};

	for (const listingDir of listingDirs) {
		const fullListingDir = `${rootDir}/${listingDir}`;
		for (const filename of await fs.readdir(fullListingDir)) {
			const fullFilename = `${rootDir}/${listingDir}/${filename}`;
			const stat = await fs.stat(fullFilename);
			if (stat.isFile() && filename.endsWith('.json')) {
				console.log(`Found auction file ${fullFilename}`);
				const auction = JSON.parse(await fs.readFile(fullFilename));
				auction.snapshotDate = listingDir;
				if (report[auction.id] === undefined) {
					report[auction.id] = { snapshots: [] };
				}
				report[auction.id].snapshots.push(auction);
			}
		}
	}

	for (const auctionId in report) {
		const auction = report[auctionId];
		const snapshots = auction.snapshots;
		if (snapshots.at(-1).snapshotDate != today) {
			auction.ended = true;
		}
	}

	return report;
}

async function createHtml(report, listingDir, { bannedUrls, crashedUrls, favUrls, deadUrls }) {
	const pugger = pug.compile(await fs.readFile('report.pug'));
	const fn = {
		parseDate(str) {
			return format.parse('dd.MM.yyyy', str);
		}
	};

	// tmp
	let i = 0;
	for (const [auctionId, auction] of Object.entries(report)) {
		if (i == 0) {
			auction.snapshots.at(-1).price = auction.snapshots[0].price / 2
		} else if (i == 1) {
			auction.snapshots.at(-1).price = auction.snapshots[0].price * 2
		}
		i++;
	}

	return pugger( { report, bannedUrls, fn } );
}