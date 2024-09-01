const fs = require('node:fs/promises');
const { DateTime } = require('luxon');
const DATE_FORMAT = 'dd.MM.yyyy';
const today = process.argv[2] ?? DateTime.now().toFormat(DATE_FORMAT);

(async function main() {
	const config = JSON.parse(await fs.readFile('config.json'));
	const listingDir = config.listing.dir;
	const auctionsDir = listingDir + '/' + today;
	const imagesDir = 'images';

	for (const filename of await fs.readdir(auctionsDir)) {
		const fullFilename = `${auctionsDir}/${filename}`;
		const stat = await fs.stat(fullFilename);
		if (stat.isFile() && filename.endsWith('.json')) {
			console.log(`Transforming ${filename}`);
			const html = await createHtml(imagesDir, fullFilename);
			const htmlFullFilename = fullFilename.replace('.json', '.html');
			await fs.writeFile(htmlFullFilename, html);
		}
	}
})();

async function createHtml(imagesDir, fullFilename) {
	const auction = JSON.parse(await fs.readFile(fullFilename));

	let imgHtml = '';
	for (let i = 1; i <= auction.imgUrls.length; i++) {
		const imgUrl = `${auction.id}_${i}.webp`;
		imgHtml += `<img src="${imagesDir}/${imgUrl}">`;
	}

	let html = `
		<!doctype html>
		<html lang=pl>
		<head>
			<meta charset=utf-8>
		<title>${auction.title}</title>
		</head>
		<body>
			<a href="${auction.url}"><h1>${auction.title}</h1></a>
			<h2>${auction.address.street ?? ''}, ${auction.address.city} ${auction.address.district}</h2>
			<h3>${new Intl.NumberFormat("pl-PL").format(auction.price)} PLN</h3>
			<h3>${auction.area} m<sup>2</sup></h3>
			<h3>${auction.rooms} pokoje</h3>
			<h3>${auction.floor.replace('FLOOR_', '')} piętro</h3>
			<p style="white-space: preserve-breaks;">${auction.fullDescription}</p>
			${imgHtml}
		</body>
		</html>
	`;

	return html;
}