/***************************************************************
* Afghanistan Flood Risk Model
* Includes:
* - Historical Rainfall (2015–2024)
* - Future Rainfall Projection (2026–2035, CMIP6 SSP2-4.5)
* - Flood History (JRC)
* - Slope (SRTM)
* - River Distance (HydroSHEDS)
* - Export: GeoTIFF + CSV + SHP (District Level)
***************************************************************/

// 1️⃣ Afghanistan Boundary
var afghanistan = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'Afghanistan'));

Map.centerObject(afghanistan, 6);

// 2️⃣ Districts
var districts = ee.FeatureCollection(
  'projects/ee-anilmasoudi99/assets/AFG_Districts_401_OCHA'
);

// =======================================================
// 🌧 3️⃣ Historical Rainfall (CHIRPS 2015–2024)
// =======================================================

var historicalRain = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterDate('2015-01-01', '2024-12-31')
  .filterBounds(afghanistan)
  .sum()
  .divide(10) // yearly average (10 years)
  .rename('Hist_Rain');

// =======================================================
// 🌧 4️⃣ Future Rainfall (CMIP6 2026–2035 SSP2-4.5)
// =======================================================

var futureRain = ee.ImageCollection('NASA/GDDP-CMIP6')
  .filterDate('2026-01-01', '2035-12-31')
  .filterBounds(afghanistan)
  .filter(ee.Filter.eq('scenario', 'ssp245'))
  .select('pr')
  .map(function(img){
    return img.multiply(86400);
  })
  .mean()
  .multiply(365)
  .rename('Future_Rain');

// Normalize rainfall layers
var histNorm = historicalRain.unitScale(0, 2000);
var futureNorm = futureRain.unitScale(0, 2000);

// =======================================================
// 🏔 5️⃣ Terrain & Rivers
// =======================================================

var dem = ee.Image('USGS/SRTMGL1_003').clip(afghanistan);
var slope = ee.Terrain.slope(dem).rename('Slope');

var rivers = ee.FeatureCollection('WWF/HydroSHEDS/v1/FreeFlowingRivers')
  .filterBounds(afghanistan);

var riverDist = ee.Image().byte().paint(rivers, 1)
  .fastDistanceTransform().sqrt()
  .rename('River_Distance');

// =======================================================
// 🌊 6️⃣ Flood History (JRC)
// =======================================================

var floodHistory = ee.ImageCollection('JRC/GSW1_3/YearlyHistory')
  .filterBounds(afghanistan)
  .select('waterClass')
  .mean()
  .rename('Flood_History')
  .unitScale(0, 3);

// =======================================================
// 📊 7️⃣ Final Flood Risk Model
// =======================================================

var floodRisk = floodHistory.multiply(0.35)
  .add(histNorm.multiply(0.25))
  .add(futureNorm.multiply(0.20))
  .add(slope.lte(5).multiply(0.10))
  .add(riverDist.lte(5000).multiply(0.10))
  .clamp(0,1)
  .rename('Flood_Risk');

// =======================================================
// 🟢 8️⃣ Classification
// =======================================================

var riskClasses = floodRisk
  .where(floodRisk.lt(0.3), 1)
  .where(floodRisk.gte(0.3).and(floodRisk.lt(0.6)), 2)
  .where(floodRisk.gte(0.6).and(floodRisk.lt(0.8)), 3)
  .where(floodRisk.gte(0.8), 4);

// Fix missing pixels
floodRisk = floodRisk.unmask(0);
riskClasses = riskClasses.unmask(1);

// Visualization
var palette = ['#ffffb2','#fecc5c','#fd8d3c','#e31a1c'];

Map.addLayer(riskClasses.clip(afghanistan),
  {min:1, max:4, palette:palette},
  'Flood Risk (Past + Future)'
);

// =======================================================
// 📍 9️⃣ Zonal Statistics by District (Dstrct_Eng)
// =======================================================

var groupedDistricts = districts
  .distinct(['Dstrct_Eng'])
  .map(function(f){
    var name = f.get('Dstrct_Eng');
    var geom = districts
      .filter(ee.Filter.eq('Dstrct_Eng', name))
      .geometry();
    return ee.Feature(geom).set('Dstrct_Eng', name);
  });

var statsByDistrict = floodRisk.reduceRegions({
  collection: groupedDistricts,
  reducer: ee.Reducer.min()
    .combine(ee.Reducer.median(), '', true)
    .combine(ee.Reducer.mean(), '', true)
    .combine(ee.Reducer.max(), '', true),
  scale: 1000,
  tileScale: 4
});

// =======================================================
// 📥 10️⃣ Export CSV + SHP
// =======================================================

Export.table.toDrive({
  collection: statsByDistrict,
  description: 'Flood_Risk_Districts_Past_Future',
  folder: 'GEE_Exports',
  fileFormat: 'CSV'
});

Export.table.toDrive({
  collection: statsByDistrict,
  description: 'Flood_Risk_Districts_Past_Future_SHP',
  folder: 'GEE_Exports',
  fileFormat: 'SHP'
});

// =======================================================
// 🗺 11️⃣ Export GeoTIFF
// =======================================================

Export.image.toDrive({
  image: riskClasses.float(),
  description: 'Afghanistan_Flood_Risk_Past_Future',
  folder: 'GEE_Exports',
  fileNamePrefix: 'flood_risk_past_future',
  region: afghanistan,
  scale: 1000,
  crs: 'EPSG:4326',
  maxPixels: 1e13
});

print('Processing Complete');
