const fs = require('node:fs/promises');
const qs = require('querystring');
const format = require('date-format');
const axios = require('axios');
const cheerio = require('cheerio');

const testMode = process.argv[2] == 'test';

(async function main() {
	const config = JSON.parse(await fs.readFile('config.json'));
	const listingDir = config.listing.dir;
	const listingUrl = config.listing.url;
	const today = format.asString('dd.MM.yyyy', new Date());
	const auctionsDir = listingDir + '/' + today;
	const imagesDir = auctionsDir + '/images';

	await fs.mkdir(auctionsDir, { recursive: true });
	await fs.mkdir(imagesDir, { recursive: true });

	if (testMode) {
		console.log('TEST MODE');
	}
	console.log('Getting list of auctions');
	const proxyUrl = getScrapeUrl(listingUrl);
	const { data } = testMode ? { data: await fs.readFile('mocks/list.mock.html', { encoding: 'utf-8' }) } : await axios.get(proxyUrl);
	const $ = cheerio.load(data);
	const articles = $('article').toArray();
	const auctions = [];

	let auctionIdx = 0;
	for (const el of articles) {
		const jqSection = $(el).children('section');
		const jqDivs = jqSection.children('div');

		const thumbnailUrl = jqDivs.eq(0).find('img').attr('src');
		const url = jqDivs.eq(1).find('a').attr('href');

		if (thumbnailUrl && url) {
			console.log(`Getting details of auction #${auctionIdx + 1}`);
			const details = await getAuctionDetails(url, auctionIdx + 1);
			const auction = { thumbnailUrl, url: 'https://www.otodom.pl' + url, ...details };
			auctions.push(auction);
			auctionIdx++;
		}
	}

	for (const [idx, auction] of auctions.entries()) {
		const auctionJson = JSON.stringify(auction, null, 2);
		await fs.writeFile(`${auctionsDir}/${auction.id}.json`, auctionJson);
		console.log(`Saving images auction ${idx + 1}/${auctions.length}`);
		await saveImagesFromAuction(imagesDir, auction);
	}
})();

function getScrapeUrl(url) {
	const proxyParams = { api_key: '5ceeb830-f7f4-4768-8941-41789b57a211', url: url };
	const proxyUrl = 'https://proxy.scrapeops.io/v1/?' + qs.stringify(proxyParams);
	return proxyUrl;
}

async function getAuctionDetails(url, auctionFileIdx) {
	const testFilename = `mocks/auction${auctionFileIdx}.html`;
	const { data } = testMode ? { data: await fs.readFile(testFilename, { encoding: 'utf-8'}) } : await axios.get(getScrapeUrl(url));
	
	return new Promise(resolve => {
		const $ = cheerio.load(data);
		const ad = JSON.parse($('#__NEXT_DATA__').eq(0).text()).props.pageProps.ad; 
		const target = ad.target;
		const title = ad.title;
		const fullDescription = ad.description;
		const price = target.Price;
		const id = target.Id;
		const area = target.Area;
		const rooms = target.Rooms_num;
		const floor = ad.property.properties.floor;
		const adr = ad.location.address;
		const address = {
			street: adr.street?.name,
			district: adr.district?.name,
			city: adr.city?.name,
		};

		const imgUrls = ad.images.map(img => img.large);

		resolve({ title, fullDescription, price, id, area, rooms, floor, address, imgUrls });
	});
}

function saveImagesFromAuction(dir, auction) {
	const { id, imgUrls } = auction;
	const results = [];
	for (const [idx, imgUrl] of imgUrls.entries()) {
		results.push(saveImage(imgUrl, `${dir}/${id}_${idx + 1}.webp`));
	}
	return Promise.all(results);
}

async function saveImage(url, filename) {
	try {
		const { data } = await axios.get(url, { responseType: 'arraybuffer' });
		return fs.writeFile(filename, data);
	} catch(e) {
		console.error(e);
	}
}
