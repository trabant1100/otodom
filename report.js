const fs = require('node:fs/promises');
const format = require('date-format');
const pug = require('pug');
const today = process.argv[2] ?? format.asString('dd.MM.yyyy', new Date());

(async function main() {
	const config = JSON.parse(await fs.readFile('config.json'));
	const listingDir = config.listing.dir;
	const { dir: reportDir, banned_urls: bannedUrls, fav_urls: favUrls, dead_urls: deadUrls } = config.report;

	const report = await generateReport(today, listingDir);
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

	// tmp
	let priceTmp = 1;
	for (const [index, snapshot] of normalized['65452541'].snapshots.entries()) {
		snapshot.price = Math.floor(snapshot.price * priceTmp);
		if (index % (2^index) == 0)
			priceTmp -= 0.01;
	}
	priceTmp = 1;
	for (const [index, snapshot] of normalized['65508720'].snapshots.entries()) {
		snapshot.price = 1189000;
		snapshot.price = Math.floor(snapshot.price * priceTmp);
		if (index % 3 == 0)
			priceTmp += 0.01;
	}


	for (const [auctionId, auction] of Object.entries(normalized)) {
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

async function generateReport(today, rootDir) {
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

async function createHtml(report, listingDir, { bannedUrls, favUrls, deadUrls }) {
	const pugger = pug.compile(await fs.readFile('report.pug'));
	const fn = {
		parseDate(str) {
			return format.parse('dd.MM.yyyy', str);
		},
		formatMoney(price) {
			return (new Intl.NumberFormat('pl-PL').format(price)) + ' zł'
		},
		translatePriceInfo(viewport, occupied, x, y, width, height) {
			const vp = dims({ left: viewport.x + 2, top: viewport.y, 
				right: viewport.x + viewport.width - 2, bottom: viewport.y + viewport.height });
			const oc = dims({ 
				left: Math.min(...occupied.map(p => p.x)),
				top: Math.min(...occupied.map(p => p.y)),
				right: Math.max(...occupied.map(p => p.x)),
				bottom: Math.max(...occupied.map(p => p.y))
			});
			const it = dims({ left: x, top: y, 
				right: x + width, bottom: y + height });
			
			let tx = 0;
			let ty = 0;

			if (translate(it, { ty: -12 }).top >= vp.top) {
				ty = -12;
				tx = 2;
				if (it.right > vp.right) {
					tx = -(it.width - oc.width + 2);
				}
			} else {
				ty = vp.top - it.top;
				if (translate(it, { tx: oc.width }).right <= vp.right) {
					tx = oc.width;
				} else {
					tx = -(it.width + 2);
				}
			}

			function dims(item) {
				return { 
					...item,
					width: item.right - item.left,
					height: item.bottom - item.top,
				};
			}

			function translate({ left, top, right, bottom }, { tx = 0, ty = 0 }) {
				return {
					left: left + tx,
					top: top + ty,
					right: right + tx,
					bottom: bottom + ty,
				};
			}

			return { x: tx, y: ty };
		}
	};

	return pugger( { report, bannedUrls, favUrls, deadUrls, fn } );
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