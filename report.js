const fs = require('node:fs/promises');
const format = require('date-format');

(async function main() {
	const config = JSON.parse(await fs.readFile('config.json'));
	const listingDir = config.listing.dir;
	const { dir: reportDir, banned_urls: bannedUrls, crashed_urls: crashedUrls, fav_urls: favUrls, dead_urls: deadUrls, vins } = config.report;
	const today = format.asString('dd.MM.yyyy', new Date());

	const report = await generateReport(today, vins, listingDir);
	console.log('Writing report json');
	await fs.mkdir(reportDir, { recursive: true });
	await fs.writeFile(`${reportDir}/${today}.json`, JSON.stringify(report, null, 2));

	const html = createHtml(report, listingDir, { bannedUrls, crashedUrls, favUrls, deadUrls });
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

function createHtml(report, listingDir, { bannedUrls, crashedUrls, favUrls, deadUrls }) {
	const header = ['img', 'date', 'price'];
	const headerHtml = header.map(str => '<th>' + str + '</th>').join('');

	let rowsHtml = '';
	for (const auctionId in report) {
		const auction = report[auctionId];
		const snapshots = auction.snapshots;
		let auctionClasses = [];
		if (bannedUrls.includes(snapshots[0].url)) {
			auctionClasses.push('banned');
		}
		if (crashedUrls.includes(snapshots[0].url)) {
			auctionClasses.push('crashed');
		}
		if (favUrls.includes(snapshots[0].url)) {
			auctionClasses.push('fav');
		}
		if (deadUrls.includes(snapshots[0].url)) {
			auctionClasses.push('dead');
		}
		if (auction.ended) {
			auctionClasses.push('ended');
		}
		rowsHtml += `
				<tr class="${auctionClasses.join(' ')}">
					<td rowspan="${snapshots.length + 1}"><img src="${snapshots[0].imgUrls[0]}" width="128"></td>
					<td colspan="${header.length - 1}">
						${snapshots[0].title} ${snapshots[0].address.street ?? ''} &nbsp;&nbsp;&nbsp; ${snapshots[0].area}m<sup>2</sup> ${snapshots[0].rooms} pokoje
						<a href="${snapshots[0].url}" target="_blank">otodom</a>
					</td>
				</tr>
			`;		
		for (const auction of snapshots) {
			const cells = [auction.snapshotDate, new Intl.NumberFormat("pl-PL").format(auction.price)];
			cells[0] = `<a href="../${listingDir}/${auction.snapshotDate}/${auction.id}.html">` + cells[0] + '</a>';
			const cellsHtml = cells.map(str => `<td>` + str + '</td>').join('');
			rowsHtml += `<tr class="${auctionClasses.join(' ')}">${cellsHtml}</tr>`;
		}
	}

	const html = `
		<!doctype html>
		<html lang=pl>
		<head>
			<meta charset=utf-8>
			<style>
				table {
					border-collapse: collapse;
				}

				table th, 
				table td {
					border: solid 1px;
					padding: 0 1em;
				}

				.banned {
					display: none;
					background-color: lightblue;
				}

				.crashed {
					display: none;
				}

				.banned.visible,
				.crashed.visible {
					display: table-row;
				}

				.fav {
					background-color: lightgreen;
				}

				.dead {
					background-color: lightgray;
				}

				.ended {
					background-color: lightgray;
				}
			</style>
			<script>

			</script>
		<title>Report</title>
		</head>
		<body>
			<input type="checkbox" id="banned" autocomplete="off"><label for="banned">Banned</label>
			<table>
				<thead>
					<tr>
						${headerHtml}
					</tr>
				</thead>
				<tbody>
					${rowsHtml}
				</tbody>
			</table>
		</body>
		<script>
			const toggles = Array.from(document.getElementsByTagName('input')).filter(el => el.type == 'checkbox');
			for (const toggle of toggles) {
				toggle.addEventListener('change', ({ target }) => {
					const { checked } = target;
					const rows = Array.from(document.getElementsByClassName(target.id));
					rows.forEach(row => checked ? row.classList.add('visible') : row.classList.remove('visible'));
				});
			}
		</script>
		</html>
	`;

	return html;
}