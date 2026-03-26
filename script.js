const API_BASE = "http://127.0.0.1:8000/api";

/* ================= CHART INSTANCES ================= */
let dashboardForecastChart = null;
let dashboardSegmentChart = null;
let forecastChart = null;
let segmentChart = null;
let productForecastChart = null;   // 👈 ADD THIS

/* ================= NAV ================= */
function showSection(sectionId) {

  const role = localStorage.getItem("role");

  // 🔐 Block non-admin users from accessing Model section
  if (sectionId === "model" && role !== "admin") {
    alert("Access denied. Admin only.");
    return;
  }

  // Hide all sections
  document.querySelectorAll(".section").forEach(s => s.classList.add("hidden"));

  // Show the target section
  const section = document.getElementById(sectionId);
  section.classList.remove("hidden");

  // Trigger chart loads based on the active section
  if (sectionId === "dashboard") {
    loadDashboardCharts();
  } else if (sectionId === "forecast") {
    // We use a tiny delay to ensure the browser has painted the display: block 
    // so the canvas has actual dimensions.
    setTimeout(() => {
      loadForecast(); 
    }, 50);
  } else if (sectionId === "segments") {
    setTimeout(() => {
      loadSegments();
    }, 50);
  }
  else if (sectionId === "product-forecast") {
  setTimeout(() => {
    loadSingleProductForecast();
  }, 50);
}
}

/* ================= FETCH ================= */
async function fetchJSON(url, options = {}) {
  const token = localStorage.getItem("token");

  const res = await fetch(url, {
    ...options,
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.href = "login.html";
    return;
  }

  if (!res.ok) throw new Error("API Error");

  return res.json();
}

/* ================= INIT ================= */
document.addEventListener("DOMContentLoaded", () => {
  loadKPIs();
  loadForecastSummary();
  showSection("dashboard");
});

/* ================= KPI ================= */
function formatCurrency(v) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

async function loadKPIs() {
  const stats = await fetchJSON(`${API_BASE}/dashboard-stats`);

  document.getElementById("total-sales").innerText =
    formatCurrency(+stats.total_sales);

  document.getElementById("total-customers").innerText =
    (+stats.total_customers).toLocaleString();

  document.getElementById("new-customers").innerText =
    (+stats.new_customers).toLocaleString();

  const acc = +stats.forecast_accuracy;
  const accEl = document.getElementById("forecast-accuracy");
  const iconEl = document.getElementById("accuracy-icon");

  let color = "text-red-500", icon = "ph-trend-down";

  if (acc >= 80) {
    color = "text-green-600";
    icon = "ph-trend-up";
  } else if (acc >= 65) {
    color = "text-yellow-500";
    icon = "ph-trend-up";
  }

  accEl.innerHTML = `<span class="${color}">${acc.toFixed(2)}%</span>`;
  iconEl.className = `ph ${icon} text-3xl ${color}`;
}

/* ================= FORECAST SUMMARY ================= */
async function loadForecastSummary() {
  const s = await fetchJSON(`${API_BASE}/forecast-summary`);

  document.getElementById("avg-sales").innerText =
    `$${(+s.avg_monthly_sales).toLocaleString()}`;

  document.getElementById("growth-rate").innerText =
    `${s.growth_rate}%`;

  document.getElementById("best-month").innerText =
    s.best_month;
}

/* ================= DASHBOARD CHARTS ================= */
async function loadDashboardCharts() {

  /* ---------- FORECAST WITH CONFIDENCE BANDS ---------- */
  if (!dashboardForecastChart) {
    const data = await fetchJSON(`${API_BASE}/forecast`);

    const labels = data.map(d =>
      new Date(d.forecast_month).toLocaleDateString("en-US", {
        month: "short"
      })
    );

    const predicted = data.map(d => d.predicted_sales);
    const lower = data.map(d => d.lower_ci);
    const upper = data.map(d => d.upper_ci);

    dashboardForecastChart = new Chart(
      document.getElementById("dashboardForecastChart"),
      {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Upper Bound",
              data: upper,
              borderColor: "rgba(37,99,235,0)",
              backgroundColor: "rgba(37,99,235,0.08)",
              fill: "+1",
              pointRadius: 0
            },
            {
              label: "Lower Bound",
              data: lower,
              borderColor: "rgba(37,99,235,0)",
              backgroundColor: "rgba(37,99,235,0.08)",
              fill: false,
              pointRadius: 0
            },
            {
              label: "Forecast",
              data: predicted,
              borderColor: "#2563eb",
              fill: false,
              tension: 0.4,
              pointRadius: 3
            }
          ]
        },
        options: {
          animation: false,
          responsive: true,
          maintainAspectRatio: false,

          plugins: {
            legend: { display: false },
            datalabels: {
              display: ctx =>
                ctx.dataset.label === "Forecast" &&
                ctx.dataIndex >= ctx.chart.data.labels.length - 3,
              anchor: "end",
              align: "top",
              offset: 4,
              color: "#1e40af",
              font: { size: 11, weight: "bold" },
              formatter: v => `${(v / 1_000_000).toFixed(2)}M`
            }
          },

          // 🔥 NO GRIDLINES
          scales: {
            x: {
              grid: { display: false },
              ticks: { autoSkip: false }
            },
            y: {
              grid: { display: false },
              ticks: {
                callback: v => `$${(v / 1_000_000).toFixed(1)}M`
              }
            }
          }
        },
        plugins: [ChartDataLabels]
      }
    );
  }

  /* ---------- CUSTOMER SEGMENTS ---------- */
  /* ---------- CUSTOMER SEGMENTS (IMPROVED DOUGHNUT) ---------- */
/* ---------- CUSTOMER SEGMENTS (FINAL FIXED VERSION) ---------- */
if (!dashboardSegmentChart) {
  const data = await fetchJSON(`${API_BASE}/segments`);

  const labels = data.map(d => d.Segment_Label);
  const counts = data.map(d => d.count);

  const total = counts.reduce((a, b) => a + b, 0);

  // 🔥 VISUAL WEIGHTING (display-only, tooltips remain honest)
  const displayCounts = counts.map(v => (v < 100 ? 100 : v));

  // 🔹 CENTER TEXT PLUGIN
  const centerTextPlugin = {
    id: "centerText",
    beforeDraw(chart) {
      const { ctx, width, height } = chart;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.font = "600 14px Inter, sans-serif";
      ctx.fillStyle = "#64748b";
      ctx.fillText("Total Customers", width / 2, height / 2 - 10);

      ctx.font = "700 20px Inter, sans-serif";
      ctx.fillStyle = "#1e40af";
      ctx.fillText(total.toLocaleString(), width / 2, height / 2 + 14);
    }
  };

  dashboardSegmentChart = new Chart(
    document.getElementById("dashboardSegmentChart"),
    {
      type: "doughnut",
      data: {
        labels,
        datasets: [{
          data: displayCounts, // 👈 weighted for visibility
          backgroundColor: [
            "#3b82f6", // Churn Risk
            "#22c55e", // High Value
            "#f59e0b", // Mid Value
            "#ef4444"  // Low Value (52)
          ],
          borderWidth: 1,
          borderColor: "#ffffff",
          hoverOffset: 6,
          spacing: 2
        }]
      },

      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        cutout: "55%",
        //rotation: 90, // avoids seam hiding tiny slices

        plugins: {
          legend: {
            position: "bottom",
            labels: {
              boxWidth: 12,
              padding: 16,
              font: { size: 11 }
            }
          },

          tooltip: {
            callbacks: {
              label: ctx => {
                const realValue = counts[ctx.dataIndex];
                const pct = ((realValue / total) * 100).toFixed(1);
                return `${ctx.label}: ${realValue.toLocaleString()} (${pct}%)`;
              }
            }
          }
        }
      },

      plugins: [centerTextPlugin]
    }
  );
}
}

async function loadSingleProductForecast() {

  const canvas = document.getElementById("productForecastChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");

  if (productForecastChart) {
    productForecastChart.destroy();
    productForecastChart = null;
  }

  try {
    const data = await fetchJSON(`${API_BASE}/product-forecast`);
    if (!data || data.length === 0) return;

    const productName = data[0].product_id;   // 👈 dynamic product name

    const labels = data.map(d =>
      new Date(d.forecast_month).toLocaleDateString("en-US", { month: "short" })
    );

    const values = data.map(d => d.predicted_sales);

    // ===== KPI CALCULATIONS =====
    const totalRevenue = values.reduce((a, b) => a + b, 0);
    const growth =
      ((values[values.length - 1] - values[0]) / values[0]) * 100;
    
      const avgMonthly = totalRevenue / values.length;

    // ===== UPDATE KPI UI =====
    document.getElementById("top-product-name").innerText = productName;
    document.getElementById("product-total-revenue").innerText =
      formatCurrency(totalRevenue);
    document.getElementById("product-growth").innerText =
      growth.toFixed(1) + "%";
    document.getElementById("product-avg-monthly").innerText =
  formatCurrency(avgMonthly);

    productForecastChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: "#7c3aed",
          backgroundColor: "rgba(124,58,237,0.2)",
          fill: true,
          tension: 0.4,
          borderWidth: 3,
          pointRadius: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }   // 👈 legend removed
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { display: false },
            ticks: {
              callback: v => `$${(v / 1000).toFixed(0)}K`
            }
          }
        }
      }
    });
    renderMonthlyBreakdown(labels, values)

  } catch (err) {
    console.error("Error loading product forecast:", err);
  }
}

function renderMonthlyBreakdown(labels, values) {
  const tbody = document.getElementById("product-breakdown-body");
  const maxValue = Math.max(...values);
  
  tbody.innerHTML = labels.map((month, i) => {
    const value = values[i];
    const prev = i > 0 ? values[i - 1] : value;
    const isIncreasing = value >= prev;
    const isPeak = value === maxValue;

    return `
      <tr class="hover:bg-slate-50/50 transition-colors">
        <td class="px-8 py-5">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg ${isIncreasing ? 'bg-emerald-50 text-emerald-500' : 'bg-rose-50 text-rose-500'}">
              <i class="ph ${isIncreasing ? 'ph-trend-up' : 'ph-trend-down'} text-lg"></i>
            </div>
            <div>
              <div class="font-bold text-slate-700">${month}</div>
              <div class="text-[10px] text-slate-500 uppercase font-medium">
                ${isIncreasing ? 'Increasing trend' : 'Decreasing trend'}
              </div>
            </div>
          </div>
        </td>

        <td class="px-8 py-5 text-right font-mono font-bold text-slate-900">
          $${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </td>

        <td class="px-8 py-5 text-right">
          <div class="flex justify-end">
            ${isPeak 
              ? `<span class="px-3 py-1 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold uppercase border border-amber-200">Peak Month</span>`
              : `<span class="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold uppercase border border-blue-100">Projected</span>`
            }
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

/* ================= OTHER PAGES ================= */
async function loadForecast() {
  const canvas = document.getElementById("forecastChart");
  const tableBody = document.getElementById("forecast-table-body"); // 👈 Selection for the table
  const ctx = canvas.getContext("2d");

  if (forecastChart) {
    forecastChart.destroy();
    forecastChart = null;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, "rgba(37, 99, 235, 0.25)");
  gradient.addColorStop(1, "rgba(37, 99, 235, 0)");

  try {
    const data = await fetchJSON(`${API_BASE}/forecast`);
    const values = data.map(d => d.predicted_sales);
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);

    // 1. GENERATE THE CHART
    forecastChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: data.map(d =>
          new Date(d.forecast_month).toLocaleDateString("en-US", {  
            month: "short" })
        ),
        datasets: [{
          label: "2014 Projection",
          data: values,
          borderColor: "#2563eb",
          borderWidth: 3,
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          pointRadius: values.map(v => (v === maxVal || v === minVal ? 6 : 0)),
          pointBackgroundColor: "#fff",
          pointBorderWidth: 3
        }]
      },
      plugins: [ChartDataLabels],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          // 1. ADD THIS to prevent the canvas from cutting off labels
          clip: false, 
          layout: {
            padding: {
              top: 30,
              bottom: 40 // Increased bottom padding to accommodate the text
            }
          },
          plugins: {
            legend: { display: false },
            datalabels: {
              display: (context) => {
                const val = context.dataset.data[context.dataIndex];
                return val === maxVal || val === minVal;
              },
              // 2. USE DYNAMIC ANCHOR: 'end' for Top, 'start' for Bottom
              anchor: (context) => {
                return context.dataset.data[context.dataIndex] === maxVal ? 'end' : 'start';
              },
              // 3. USE DYNAMIC ALIGN: 'top' for Top, 'bottom' for Bottom
              align: (context) => {
                return context.dataset.data[context.dataIndex] === maxVal ? 'top' : 'bottom';
              },
              offset: 10, 
              color: (context) => context.dataset.data[context.dataIndex] === maxVal ? '#16a34a' : '#dc2626',
              font: { weight: 'bold', size: 12 },
              formatter: (v) => v === maxVal ? `Peak: $${(v/1e6).toFixed(2)}M` : `Down: $${(v/1e6).toFixed(2)}M`
            }
          },
          scales: {
            x: { 
              grid: { display: false }, 
              border: { display: false },
              // 4. ADD OFFSET to the X-axis so the first point isn't touching the left edge
              offset: true 
            },
            y: { 
              grid: { display: false }, 
              border: { display: false }, 
              ticks: { display: false },
              // 5. GIVE THE Y-AXIS ROOM: This forces the "Down" point higher up
              beginAtZero: false,
              suggestedMin: minVal * 0.8 
            }
          }
        }
    });

    // 2. UPDATE SUMMARY CARDS
    updateForecastSummary(values, data);

    // 3. POPULATE THE MONTHLY TABLE 👈 NEW LOGIC
// Inside loadForecast, after calculating avgMonthly
if (tableBody) {
  tableBody.innerHTML = data.map((d) => {
    const monthName = new Date(d.forecast_month).toLocaleDateString("en-US", { month: "long" });
    const val = d.predicted_sales;
    
    // Trend Logic: Compare vs Average
    const isAboveAvg = val >= (values.reduce((a, b) => a + b, 0) / values.length);
    const trendIcon = isAboveAvg ? 'ph-trend-up text-emerald-500' : 'ph-trend-down text-rose-500';
    const trendBg = isAboveAvg ? 'bg-emerald-50' : 'bg-rose-50';

    return `
      <tr class="hover:bg-slate-50 transition-colors group">
        <td class="px-6 py-4 font-medium text-slate-700">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg ${trendBg}">
              <i class="ph ${trendIcon} text-lg"></i>
            </div>
            ${monthName}
          </div>
        </td>
        <td class="px-6 py-4 text-right text-slate-600 font-mono font-semibold">
          $${val.toLocaleString()}
        </td>
        <td class="px-6 py-4 text-right">
          <span class="px-3 py-1 rounded-full text-xs font-bold ${val === Math.max(...values) ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}">
            ${val === Math.max(...values) ? "Annual Peak" : "Projected"}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

  } catch (error) {
    console.error("Error loading forecast data:", error);
  }
}

function updateForecastSummary(values, data) {
  const total2014 = values.reduce((a, b) => a + b, 0);
  const total2013 = total2014 * 0.85; 
  const growth = ((total2014 - total2013) / total2013 * 100).toFixed(1);
  
  // New Calculations
  const avgMonthly = total2014 / values.length;
  const maxVal = Math.max(...values);
  const peakData = data.find(d => d.predicted_sales === maxVal);
  const peakMonth = new Date(peakData.forecast_month).toLocaleDateString("en-US", { month: "short" });

  // Update Elements
  document.getElementById("total-rev-2014").innerText = `$${(total2014 / 1e6).toFixed(2)}M`;
  document.getElementById("growth-pct").innerText = `+${growth}%`;
  
  // Update New Elements
  document.getElementById("avg-monthly-rev").innerText = `$${(avgMonthly / 1e6).toFixed(2)}M`;
  document.getElementById("peak-month-name").innerText = peakMonth;
}

async function exportForecastToCSV() {
  const data = await fetchJSON(`${API_BASE}/forecast`);
  let csv = "Month,Revenue,Status\n";
  const maxVal = Math.max(...data.map(d => d.predicted_sales));

  data.forEach(d => {
    const month = new Date(d.forecast_month).toLocaleDateString("en-US", { month: "long" });
    const status = d.predicted_sales === maxVal ? "Peak" : "Normal";
    csv += `${month},${d.predicted_sales},${status}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Forecast_Data_2014.csv';
  a.click();
}

/* ================= OTHER PAGES ================= */

async function loadSegments() {
  const canvas = document.getElementById("segmentChart");
  const tableBody = document.getElementById("segment-table-body");
  if (!canvas || !tableBody) return;

  if (segmentChart) {
    segmentChart.destroy();
    segmentChart = null;
  }

  // Colors mapped to segments: Blue (Churn), Green (High), Orange (Mid), Red (Low)
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444"];

  try {
    const data = await fetchJSON(`${API_BASE}/segments`);
    const totalReal = data.reduce((sum, d) => sum + d.count, 0);

    // 1. Update Insight Cards
    updateSegmentInsights(data, totalReal);

    // 2. Build Horizontal Bar Chart
    segmentChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: data.map(d => d.Segment_Label),
        datasets: [{
          data: data.map(d => d.count),
          backgroundColor: colors.map(c => c + 'CC'),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 6,
          barThickness: 32
        }]
      },
      plugins: [ChartDataLabels],
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            anchor: 'end',
            align: 'right',
            offset: 8,
            color: '#475569',
            font: { weight: 'bold', size: 12 },
            formatter: (value) => value.toLocaleString()
          }
        },
        scales: {
          x: { display: false, grid: { display: false } },
          y: { 
            grid: { display: false },
            ticks: { font: { weight: 'bold' }, color: '#334155' }
          }
        },
        layout: { padding: { right: 60 } }
      }
    });

    // 3. Build Table with Dynamic Action Buttons
    tableBody.innerHTML = data.map((d, index) => {
      const percentage = ((d.count / totalReal) * 100).toFixed(1);
      const dotColor = colors[index % colors.length];
      
      // Dynamic Button Logic
      let actionBtn = '';
      if (d.Segment_Label === 'Churn Risk') {
        actionBtn = `<button class="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1 rounded text-[10px] font-bold uppercase transition-all">Win-back</button>`;
      } else if (d.Segment_Label === 'High Value') {
        actionBtn = `<button class="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 rounded text-[10px] font-bold uppercase transition-all">Reward</button>`;
      } else {
        actionBtn = `<button class="bg-slate-700 hover:bg-slate-800 text-white px-3 py-1 rounded text-[10px] font-bold uppercase transition-all">Nurture</button>`;
      }

      return `
        <tr class="hover:bg-slate-50 transition-colors group">
          <td class="px-6 py-4">
            <div class="flex items-center gap-3">
              <span class="w-3 h-3 rounded-full shadow-sm" style="background-color: ${dotColor}"></span>
              <span class="font-semibold text-slate-700">${d.Segment_Label}</span>
            </div>
          </td>
          <td class="px-6 py-4 text-right text-slate-600 font-mono font-medium">
            ${d.count.toLocaleString()}
          </td>
          <td class="px-6 py-4 text-right">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200">
              ${percentage}%
            </span>
          </td>
          <td class="px-6 py-4 text-center">
            ${actionBtn}
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error("Error loading segment data:", err);
  }
}

// Helper function to keep data synced in the top insight cards
function updateSegmentInsights(data, total) {
  data.forEach(d => {
    const pct = ((d.count / total) * 100).toFixed(1);
    if (d.Segment_Label === 'Churn Risk') {
      document.getElementById('churn-count').innerText = d.count.toLocaleString();
      document.getElementById('churn-insight-text').innerText = `${pct}% at Churn Risk`;
    } else if (d.Segment_Label === 'High Value') {
      document.getElementById('high-value-count').innerText = d.count.toLocaleString();
    } else if (d.Segment_Label === 'Mid Value') {
      document.getElementById('mid-value-count').innerText = d.count.toLocaleString();
    }
  });
}

/* ================= 3D EFFECTS ================= */
// This must be outside of any other function so it runs on page load
document.querySelectorAll(".hover-3d").forEach(card => {
  card.addEventListener("mousemove", e => {
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const rotateX = ((y / rect.height) - 0.5) * 12;
    const rotateY = ((x / rect.width) - 0.5) * -12;

    card.style.transform =
      `translateY(-8px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`;
  });

  card.addEventListener("mouseleave", () => {
    card.style.transform =
      "translateY(0) rotateX(0) rotateY(0)";
  });
});

/* ================= MODEL MANAGEMENT ================= */

async function uploadCSV() {
  const fileInput = document.getElementById("csvFile");

  if (!fileInput.files.length) {
    alert("Please select a CSV file.");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  const token = localStorage.getItem("token");

  try {
    const res = await fetch(`${API_BASE}/upload-csv`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token
      },
      body: formData
    });

    if (res.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "login.html";
      return;
    }

    const data = await res.json();
    alert(data.message || data.error);

  } catch (err) {
    console.error(err);
    alert("Upload failed.");
  }
}

async function retrainModel() {
  try {
    document.getElementById("training-loader").classList.remove("hidden");
    document.getElementById("model-status").innerText = "Training...";

    await fetchJSON(`${API_BASE}/retrain`, {
  method: "POST"
});
    alert("Model retraining started!");

  } catch (err) {
    console.error(err);
    alert("Retrain failed.");
  }
}

async function checkModelStatus() {
  try {
    const data = await fetchJSON(`${API_BASE}/model-status`);

    if (!data) return; // handles 401 redirect case

    const statusEl = document.getElementById("model-status");
    const lastEl = document.getElementById("last-trained");

    statusEl.innerText = data.status;
    lastEl.innerText = data.last_trained;

    if (data.status === "Training") {
      document.getElementById("training-loader").classList.remove("hidden");
      statusEl.className = "text-xl font-bold text-yellow-600";
    } 
    else if (data.status === "Completed") {
      document.getElementById("training-loader").classList.add("hidden");
      statusEl.className = "text-xl font-bold text-green-600";

      loadKPIs();
      loadForecastSummary();
      loadDashboardCharts();
    } 
    else if (data.status && data.status.includes("Failed")) {
      document.getElementById("training-loader").classList.add("hidden");
      statusEl.className = "text-xl font-bold text-red-600";
    }

  } catch (err) {
    console.error("Model status error:", err);
  }
}
// Auto-check every 3 seconds
setInterval(checkModelStatus, 3000);

function logout() {
  // Clear authentication data
  localStorage.removeItem("token");
  localStorage.removeItem("role");

  // Redirect to login page
  window.location.href = "index.html";  // change if your login page name is different
}
