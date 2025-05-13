const margin = { top: 60, right: 150, bottom: 50, left: 60 };
const width = 600 - margin.left - margin.right;
const height = 400 - margin.top - margin.bottom;

let rawData = [];
const healthGroups = ['Healthy', 'Pre-diabetic', 'Type 2 Diabetic'];
const colorScale = d3.scaleOrdinal()
    .domain(healthGroups)
    .range(['#1f77b4', '#ff7f0e', '#2ca02c']);

function parseRow(r) {
    const carbs = parseFloat((r['Carbs'] || '').trim());
    const protein = parseFloat((r['Protein'] || '').trim());
    const fat = parseFloat((r['Fat'] || '').trim());
    if ([carbs, protein, fat].some(x => isNaN(x))) return;

    let nutrientFocus = 'High-Carb';
    if (protein > carbs && protein >= fat) nutrientFocus = 'High-Protein';
    else if (fat > carbs && fat > protein) nutrientFocus = 'High-Fat';

    const a1cVal = parseFloat((r['A1c PDL (Lab)'] || '').trim());
    let healthGroup = 'Healthy';
    if (a1cVal >= 6.5) healthGroup = 'Type 2 Diabetic';
    else if (a1cVal >= 5.7) healthGroup = 'Pre-diabetic';

    const sensors = [
        { gl: '#1 Contour Fingerstick GLU', t: 'Time (t)' },
        { gl: ' #2 Contour Fingerstick GLU', t: 'Time (t).1' },
        { gl: '#3 Contour Fingerstick GLU', t: 'Time (t).2' }
    ];
    sensors.forEach(s => {
        const glRaw = r[s.gl], tRaw = r[s.t];
        if (!glRaw || !tRaw) return;
        const glVal = parseFloat(glRaw);
        const parts = tRaw.trim().split(':').map(x => parseInt(x, 10));
        if (isNaN(glVal) || parts.length !== 2) return;
        const [mm, ss] = parts;
        if (isNaN(mm) || isNaN(ss)) return;
        rawData.push({ nutrientFocus, healthGroup, time: mm + ss / 60, glucose: glVal, carbs, protein, fat });
    });
    ['Dexcom GL', 'Libre GL'].forEach(key => {
        const val = parseFloat((r[key] || '').trim());
        if (!isNaN(val)) rawData.push({ nutrientFocus, healthGroup, time: 0, glucose: val, carbs, protein, fat });
    });
}

function getCheckedHealthGroups() {
    return Array.from(document.querySelectorAll('.health-checkbox:checked')).map(cb => cb.value);
}

function initialize() {
    d3.select('#nutrientFocus').on('change', updateChart);

    // Listen for changes on any health group checkbox
    document.querySelectorAll('.health-checkbox').forEach(cb => {
        cb.addEventListener('change', function (e) {
            const checkedBoxes = document.querySelectorAll('.health-checkbox:checked');
            // Prevent unchecking last box
            if (checkedBoxes.length === 0) {
                e.target.checked = true;
            }
            updateChart();
        });
    });

    const svg = d3.select('#lineChart').append('svg')
        .attr('width', width + margin.left + margin.right)
        .attr('height', height + margin.top + margin.bottom)
      .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)
        .attr('class', 'line-g');

    svg.append('g').attr('class', 'x-axis').attr('transform', `translate(0,${height})`);
    svg.append('g').attr('class', 'y-axis');
    svg.append('g').attr('class', 'legend')
       .attr('transform', `translate(${width + 20},0)`);

    updateChart();
}

function updateChart() {
    if (!rawData.length) {
        console.warn("No data available to update charts.");
        return;
    }

    const focus = d3.select('#nutrientFocus').property('value');
    const groupsToPlot = getCheckedHealthGroups();

    // Always at least one group due to logic above
    const datasets = groupsToPlot.map(hg => {
        const filtered = rawData.filter(d =>
            d.nutrientFocus === focus && d.healthGroup === hg
        );
        const agg = d3.rollup(filtered,
            v => d3.mean(v, d => d.glucose),
            d => d.time
        );
        const pts = Array.from(agg, ([time, mean]) => ({ time, mean }))
            .sort((a, b) => a.time - b.time);
        return { group: hg, points: pts };
    });
    renderChart(datasets, focus);
    renderDonutChart(focus, groupsToPlot);
}

function renderChart(datasets, focus) {
    const svgSel = d3.select('#lineChart svg');
    const g = d3.select('.line-g');
    g.selectAll('.data-line').remove();
    g.selectAll('.grid-x').remove();
    g.selectAll('.grid-y').remove();

    // Add or update clipPath for the chart area
    svgSel.select('defs').remove();
    svgSel.insert('defs', ':first-child')
        .append('clipPath')
        .attr('id', 'chart-clip')
        .append('rect')
        .attr('width', width)
        .attr('height', height);

    // Group for lines, clipped to chart area
    let linesGroup = g.select('.lines-group');
    if (linesGroup.empty()) {
        linesGroup = g.append('g').attr('class', 'lines-group').attr('clip-path', 'url(#chart-clip)');
    } else {
        linesGroup.attr('clip-path', 'url(#chart-clip)');
        linesGroup.selectAll('*').remove();
    }

    const allTimes = datasets.flatMap(d => d.points.map(p => p.time));
    const allMeans = datasets.flatMap(d => d.points.map(p => p.mean));
    const x = d3.scaleLinear().domain(d3.extent(allTimes)).nice().range([0, width]);
    const y = d3.scaleLinear().domain(d3.extent(allMeans)).nice().range([height, 0]);

    // Add zoom behavior
    const zoom = d3.zoom()
        .scaleExtent([1, 10])
        .translateExtent([[0, 0], [width, height]])
        .extent([[0, 0], [width, height]])
        .on("zoom", zoomed);

    svgSel.call(zoom);

    g.append('g')
     .attr('class', 'grid-x')
     .attr('transform', `translate(0,${height})`)
     .call(d3.axisBottom(x).tickSize(-height).tickFormat(''))
     .selectAll('line').style('stroke', '#e2e8f0');

    g.append('g')
     .attr('class', 'grid-y')
     .call(d3.axisLeft(y).tickSize(-width).tickFormat(''))
     .selectAll('line').style('stroke', '#e2e8f0');

    g.select('.x-axis').transition().duration(600).call(d3.axisBottom(x));
    g.select('.y-axis').transition().duration(600).call(d3.axisLeft(y));

    // X axis label
    g.selectAll('.x-axis-label').remove();
    g.append('text')
        .attr('class', 'x-axis-label')
        .attr('text-anchor', 'middle')
        .attr('x', width / 2)
        .attr('y', height + 40)
        .style('font-size', '16px')
        .style('fill', '#333')
        .text('Minutes After Meal');

    // Y axis label
    g.selectAll('.y-axis-label').remove();
    g.append('text')
        .attr('class', 'y-axis-label')
        .attr('text-anchor', 'middle')
        .attr('transform', `rotate(-90)`)
        .attr('x', -height / 2)
        .attr('y', -48)
        .style('font-size', '16px')
        .style('fill', '#333')
        .text('Blood Glucose (mg/dL)');

    const lineGen = d3.line()
        .x(d => x(d.time))
        .y(d => y(d.mean))
        .curve(d3.curveMonotoneX);

    datasets.forEach(ds => {
        const path = linesGroup.append('path')
            .datum(ds.points)
            .attr('class', 'data-line')
            .attr('fill', 'none')
            .attr('stroke', colorScale(ds.group))
            .attr('stroke-width', 2)
            .attr('d', lineGen);

        const totalLength = path.node().getTotalLength();
        path.attr('stroke-dasharray', `${totalLength} ${totalLength}`)
            .attr('stroke-dashoffset', totalLength)
            .transition()
            .duration(600)
            .ease(d3.easeLinear)
            .attr('stroke-dashoffset', 0);
    });

    const legend = d3.select('.legend');
    legend.selectAll('*').remove();
    datasets.forEach((ds, i) => {
        const yPos = i * 20;
        const entry = legend.append('g').attr('transform', `translate(0,${yPos})`);
        entry.append('rect').attr('width', 12).attr('height', 12).attr('fill', colorScale(ds.group));
        entry.append('text').attr('x', 16).attr('y', 10).text(ds.group);
    });

    g.selectAll('.title').remove();
    g.append('text')
     .attr('class', 'title')
     .attr('x', width / 2).attr('y', -18)
     .attr('text-anchor', 'middle')
     .attr('style', 'font-size:18px;font-weight:700;fill:#2d3748;max-width:440px;white-space:pre-line;')
     .text(`Glucose Response (${focus}) by Health Group`);

    function zoomed(event) {
        const t = event.transform;
        const zx = t.rescaleX(x);
        const zy = t.rescaleY(y);

        // Redraw axes
        g.select('.x-axis').call(d3.axisBottom(zx));
        g.select('.y-axis').call(d3.axisLeft(zy));

        // Redraw lines, clipped
        const lineGen = d3.line()
            .x(d => zx(d.time))
            .y(d => zy(d.mean))
            .curve(d3.curveMonotoneX);

        linesGroup.selectAll('.data-line')
            .attr('d', d => lineGen(d));
    }
}

function renderDonutChart(focus, groups) {
    const svgContainer = d3.select('#donutChart');
    svgContainer.selectAll('*').remove();

    let filtered = rawData.filter(d => d.nutrientFocus === focus && groups.includes(d.healthGroup));
    if (!filtered.length) return;

    const meanCarbs = d3.mean(filtered, d => d.carbs);
    const meanProtein = d3.mean(filtered, d => d.protein);
    const meanFat = d3.mean(filtered, d => d.fat);
    const meanCalories = meanCarbs * 4 + meanProtein * 4 + meanFat * 9;

    const data = [
        { label: 'Carbs', value: meanCarbs, color: '#4fd1c5', index: 0 },
        { label: 'Protein', value: meanProtein, color: '#63b3ed', index: 1 },
        { label: 'Fat', value: meanFat, color: '#fc8181', index: 2 }
    ];

    const w = 480, h = 400, r = 120;
    const svg = svgContainer.append('svg')
        .attr('width', w).attr('height', h)
      .append('g')
        .attr('transform', `translate(${r + 40},${h / 2})`);

    const arc = d3.arc().innerRadius(r - 40).outerRadius(r);
    const pie = d3.pie()
        .sort((a, b) => a.index - b.index) // Always keep order: Carbs, Protein, Fat
        .value(d => d.value);

    // Store previous data for smooth transitions
    if (!renderDonutChart.prevData) {
        renderDonutChart.prevData = [
            { label: 'Carbs', value: meanCarbs, color: '#4fd1c5', index: 0 },
            { label: 'Protein', value: meanProtein, color: '#63b3ed', index: 1 },
            { label: 'Fat', value: meanFat, color: '#fc8181', index: 2 }
        ];
    }
    const prevData = renderDonutChart.prevData;

    // Bind data and animate arcs to new values, keeping order fixed
    const arcs = svg.selectAll('path')
        .data(pie(data), d => d.data.label);

    arcs.enter()
        .append('path')
        .attr('fill', d => d.data.color)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .each(function(d, i) {
            // Set initial state to previous data for smooth animation
            const prevPie = pie(prevData);
            this._current = prevPie[i];
        })
        .on('mouseover', function(event, d) {
            d3.select(this).style('opacity', 0.8);
            showTooltip(event, `${d.data.label}: ${d.data.value.toFixed(1)}g`);
        })
        .on('mouseout', function() {
            d3.select(this).style('opacity', 1);
            hideTooltip();
        })
        .transition()
        .duration(600)
        .attrTween('d', function(d, i) {
            const prevPie = pie(prevData);
            const interpolate = d3.interpolate(prevPie[i], d);
            this._current = interpolate(1);
            return function(t) {
                return arc(interpolate(t));
            };
        });

    arcs.transition()
        .duration(600)
        .attrTween('d', function(d, i) {
            const prevPie = pie(prevData);
            const interpolate = d3.interpolate(this._current || prevPie[i], d);
            this._current = interpolate(1);
            return function(t) {
                return arc(interpolate(t));
            };
        });

    arcs.exit().remove();

    renderDonutChart.prevData = data.map(d => ({ ...d })); // Save for next update

    svg.selectAll('.calories-text').remove();
    svg.append('text')
        .attr('class', 'calories-text')
        .attr('text-anchor', 'middle')
        .attr('y', -10)
        .style('font-size', '32px')
        .style('font-weight', 'bold')
        .style('fill', '#222')
        .text(Math.round(meanCalories));

    svg.append('text')
        .attr('class', 'calories-text')
        .attr('text-anchor', 'middle')
        .attr('y', 22)
        .style('font-size', '16px')
        .style('fill', '#666')
        .text('Avg Calories');

    const legend = svg.append('g').attr('transform', `translate(${r + 80},${-r + 10})`);
    data.forEach((d, i) => {
        legend.append('rect')
            .attr('x', 0).attr('y', i * 26)
            .attr('width', 16).attr('height', 16)
            .attr('fill', d.color);
        legend.append('text')
            .attr('x', 22).attr('y', i * 26 + 13)
            .attr('class', 'donut-legend-text')
            .style('font-size', '14px')
            .style('font-weight', 'bold')
            .style('fill', '#222')
            .text(`${d.label}: ${d.value.toFixed(1)}g`)
            .on('click', () => toggleSegment(d.label));
    });

    // Add hover effect for donut legend text (turn blue)
    svg.selectAll('.donut-legend-text')
        .on('mouseover', function() {
            d3.select(this).style('fill', '#38bdf8');
        })
        .on('mouseout', function() {
            d3.select(this).style('fill', '#222');
        });
}

function showTooltip(event, text) {
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('background', '#fff')
        .style('border', '1px solid #ccc')
        .style('padding', '8px')
        .style('border-radius', '4px')
        .style('box-shadow', '0 2px 8px rgba(0, 0, 0, 0.1)')
        .style('pointer-events', 'none')
        .style('font-size', '14px')
        .style('color', '#333')
        .html(text);

    tooltip.style('left', `${event.pageX + 10}px`)
        .style('top', `${event.pageY + 10}px`);
}

function hideTooltip() {
    d3.select('.tooltip').remove();
}

function toggleSegment(label) {
    console.log(`Toggled visibility for ${label}`);
    // Add logic to toggle visibility of the corresponding segment
}

function showLoading(show) {
    const loadingDiv = document.getElementById('loading');
    const containerDiv = document.querySelector('.container');
    if (show) {
        if (loadingDiv) loadingDiv.style.display = 'flex';
        if (containerDiv) containerDiv.style.display = 'none';
    } else {
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (containerDiv) containerDiv.style.display = '';
    }
}

// Show loading at the start
showLoading(true);

// Fetch and parse data
fetch('./merged_data.csv.zip')
    .then(res => {
        if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
        return res.arrayBuffer();
    })
    .then(JSZip.loadAsync)
    .then(zip => {
        const file = zip.file("merged_data.csv");
        if (!file) throw new Error("merged_data.csv not found in the ZIP archive.");
        return file.async("string");
    })
    .then(text => {
        const rows = d3.csvParse(text);
        rows.forEach(parseRow);
        initialize();
        showLoading(false); // Hide loading, show content
    })
    .catch(err => {
        console.error("Error loading or parsing data:", err);
        alert("Failed to load data. Please check the console for details.");
        showLoading(false);
    });
