const fs = require('node:fs/promises');
const fn = require('./chart.js');
const { DateTime } = require('luxon');
const pug = require('pug');
const DATE_FORMAT = 'dd.MM.yyyy';
const today = process.argv[2] ?? DateTime.now().toFormat(DATE_FORMAT);

(async function main() {
	const config = JSON.parse(await fs.readFile('config.json'));
	const listingDir = config.listing.dir;
	const { dir: reportDir, banned_urls: bannedUrls, fav_urls: favUrls, dead_urls: deadUrls, 
		relisted_urls: relistedUrls } = config.report;

	const report = await generateReport(today, relistedUrls, listingDir);
	console.log('Writing report json');
	await fs.mkdir(reportDir, { recursive: true });
	await fs.writeFile(`${reportDir}/${today}.json`, JSON.stringify(report, null, 2));

	const html = await createHtml(normalizeReport(report), listingDir, { bannedUrls, favUrls, deadUrls });
	console.log('Writing report html');
	await fs.writeFile(`${reportDir}/${today}.html`, html);

	console.log('Writing redirect html');
	await fs.writeFile('index.html', createRedirectHtml(reportDir, today));
})();

function normalizeReport(report) {
	const normalized = JSON.parse(JSON.stringify(report));
	const scale = {
		priceMargin: 8,
		price: 40,
		date: 150
	};

	for (const [auctionId, auction] of Object.entries(normalized)) {
		const auction = normalized[auctionId];
		auction.snapshots = auction.snapshots.toSorted((s1, s2) => {
			const date1 = DateTime.fromFormat(s1.snapshotDate, DATE_FORMAT);
			const date2 = DateTime.fromFormat(s2.snapshotDate, DATE_FORMAT);
			
			return date1.toMillis() - date2.toMillis();
		}).filter((snapshot, index, arr) => {
			return !index || snapshot.snapshotDate != arr[index - 1].snapshotDate;
		});

		const minPrice = Math.min(...auction.snapshots.map(s => s.price));
		const maxPrice = Math.max(...auction.snapshots.map(s => s.price));
		const diff = maxPrice - minPrice;
		for (const [index, snapshot] of auction.snapshots.entries()) {
			const prevSnapshot = auction.snapshots[index > 0 ? index - 1 : 0];
			snapshot.floor = snapshot.floor == 'GROUND_FLOOR' ? 0 : Number.parseInt(snapshot.floor.replace('FLOOR_', ''));
			snapshot.normalized = {
				price: Math.round(normalize(minPrice, maxPrice, scale.priceMargin, scale.price - scale.priceMargin, snapshot.price)),
				date: Math.round(normalize(0, auction.snapshots.length - 1, 0, scale.date, index)),
			};
			if (prevSnapshot.price != snapshot.price) {
				prevSnapshot.normalized.priceChanged = true;
				snapshot.normalized.priceChanged = true;
			}
		}
		auction.snapshots[0].normalized.priceChanged = true;
		auction.snapshots.at(-1).normalized.priceChanged = true;
		auction.normalized = {
			scale: { ...scale }
		};
	}

	return normalized;
}

function normalize(min, max, newMin, newMax, value) {
	const diff = max - min;
	const newDiff = newMax - newMin;
	if (diff == 0) {
		return newDiff / 2;
	}

	return (value - min) * newDiff / diff + newMin;
}

async function generateReport(today, relistedUrls, rootDir) {
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
		const date1 = DateTime.fromFormat(fname1, DATE_FORMAT);
		const date2 = DateTime.fromFormat(fname2, DATE_FORMAT);
		
		return date1.toMillis() - date2.toMillis();
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

	const relistedAuctions = [];
	for (const [auctionId, auction] of Object.entries(report)) {
		const lastSnapshot = auction.snapshots.at(-1);
		const url = lastSnapshot.url;
		for (const [i, urls] of Object.entries(relistedUrls)) {
			if (urls.includes(url)) {
				const auction = getAuctionByUrl(url);
				if (relistedAuctions[i] === undefined) {
					relistedAuctions[i] = [];
				}
				relistedAuctions[i].push(auction);
			}
		}
	}

	for (const auctions of relistedAuctions) {
		auctions.sort((auction1, auction2) => {
			const date1 = DateTime.fromFormat(auction1.snapshots.at(-1).snapshotDate, DATE_FORMAT);
			const date2 = DateTime.fromFormat(auction2.snapshots.at(-1).snapshotDate, DATE_FORMAT);
			
			return date1.toMillis() - date2.toMillis();
		});
		const allUrls = auctions.map(auction => auction.snapshots.at(-1).url);
		for (const auction of auctions) {
			for (const snapshot of auction.snapshots) {
				snapshot.alternateUrls = allUrls;
			}
		}
		const lastAuction = auctions.at(-1);
		report[lastAuction.snapshots.at(-1).id].snapshots = auctions.flatMap(auction => auction.snapshots);
	}

	for (const auctionId in report) {
		const auction = report[auctionId];
		const snapshots = auction.snapshots;
		if (snapshots.at(-1).snapshotDate != today) {
			auction.ended = true;
		}
	}

	function getAuctionByUrl(url) {
		return Object.values(report).find(auction => auction.snapshots.at(-1).url == url);
	}

	return report;
}

async function createHtml(report, listingDir, { bannedUrls, favUrls, deadUrls }) {
	const pugger = pug.compile(await fs.readFile('report.pug'), { filename: 'pug' });
	const scale = {
		xMargin: 2,
		priceMargin: 8,
		price: 40,
		date: 150
	};

	return pugger( { report, bannedUrls, favUrls, deadUrls, scale, fn } );
}

function createRedirectHtml(reportDir, today) {
	return `
		<!doctype html>
		<html lang=pl>
			<head>
				<meta charset=utf-8>
				<meta http-equiv="refresh" content="0; url=./${reportDir}/${today}.html">
				<title>Report</title>
			</head>
			<body>
			</body>
		</html>
	`;
}