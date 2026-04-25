# Project Context: Sequence & Skip Order Analyzer

## 1. Project Overview
The **Sequence & Skip Order Analyzer** is a comprehensive, full-stack web application designed for Production Planning and Control (PPC) within a modern automotive manufacturing environment. Built to support Just-in-Sequence (JIS) and Just-in-Time (JIT) methodologies, the application processes raw vehicle delivery sequence numbers (DSN) and production reports to automatically identify sequence anomalies, isolate held vehicles, and dynamically map part shortages to specific production days and sequence numbers.

## 2. Technology Stack
* **Backend:** Python 3.x, Flask (Web Framework), Pandas (Data processing & extraction), NumPy, io (In-memory file processing).
* **Frontend:** HTML5, CSS3, JavaScript (Vanilla/ES6).
* **UI Framework:** Bootstrap 5.3, Bootstrap Icons.
* **Visualization:** Chart.js, Chartjs-plugin-datalabels.
* **Deployment Architecture:** Single-page application (SPA) paradigm with RESTful API endpoints for asynchronous file processing.

## 3. Core Features & Capabilities

### A. Sequence & Capacity Configuration
* **Daily Capacity Input:** Defines the expected output rate (Standard: 1070 minutes/day; Thursdays adjusted to 1010 minutes).
* **Takt Time Calculator:** Automatically calculates the takt time based on the daily capacity and available shift minutes.
* **Shift & Break Logic:** Maps vehicle rollout times starting at 7:00 AM, integrating standard assembly line breaks (11:30 AM - 12:00 PM and 8:30 PM - 9:00 PM).
* **Holiday Exclusion:** Allows users to dynamically input holiday dates. The sequence engine automatically fast-forwards past Sundays and user-defined holidays to ensure accurate date projections.

### B. Part Shortage Mapping (Impact Engine)
* **Dynamic Inputs:** Users can input multiple shortage parts simultaneously.
* **Shortage Parameters:** Accepts Part Number, Reference Order Number, Shortage Quantity, and an Excel file mapping the part to specific vehicle variants (extracted from Column F).
* **Heatmap Highlighting:** Generates a visual heatmap in the data preview. Rows are highlighted from light yellow (1 shortage) to dark red (4+ shortages), with explicit `⚠️ SHORTAGE` or `Covered` badges for individual part columns based on stock availability from the reference order.

### C. Data Processing & Stratification
* **Anomaly Detection:** Identifies "Skip Orders" (vehicles physically trapped in out-of-sequence blocks at the TRIM LINE) and explicitly marked "Hold Orders".
* **Vehicle Stratification:** * **Model Extraction:** Extracts the base model from the first 5 characters of the description (including the 6th if 'T', 'S', or 'M').
    * **Work Content (HWC/LWC):** Categorizes vehicles into High Work Content (Buses, or specific variant/description masks) and Low Work Content.
    * **Region:** Classifies units as Domestic (variant starts with 'V') or Export.
    * **Type:** Segregates between Truck and Bus production streams.

### D. Visualizations & Dashboards
* **Pie Charts:** Hold and Skip orders stratified by Vehicle Model.
* **Bar Charts (Side-by-Side):** Hold and Skip orders analyzed by Type, Work Content, and Region.
* **Data Grids:** Scrollable, sticky-header tables isolating Gaps, Skip Orders, Hold Orders, and a comprehensive Master Preview.

### E. Shortage Impact Analysis (Inference Window)
* Translates sequence logic into actionable supply chain data.
* Outputs a dynamic impact card per missing part detailing:
    * The absolute First Shortage Date.
    * The specific Line in Sequence numbers affected on that first day.
    * The exact Connecting Models affected.
    * A 4-day forecast table comparing the "Day Plan" (total units scheduled needing the part) vs. the "Shortage Qty" (units that will actually be starved).

## 4. File & Asset Structure

### `app.py` (The Engine)
* **Role:** The Flask server and Pandas processor.
* **Endpoints:**
    * `/` -> Serves the UI.
    * `/api/analyze` -> Handles `multipart/form-data` uploads (Main file + N Shortage Files).
* **Key Functions:** `analyze_sequence()`. Handles strict sequence anomaly block tracking, computes string manipulations for DSN/Variant/Model, and formats JSON payload.

### `templates/index.html` (The Interface)
* **Role:** The presentation and client-side scheduling layer.
* **Key Scripts:**
    * `applySequence()`: Handles the highly complex date/time iteration, calculating takt times and advancing the clock while skipping holidays/Sundays.
    * `generateInference()`: Parses the scheduled sequence to build the shortage impact tables.
    * `renderCharts()`: Manages Chart.js lifecycle (destroying old instances, rendering multi-stratification layouts).
    * `downloadCSV()`: Converts localized table states into exportable Excel-compatible `.csv` files.

## 5. Domain-Specific Business Rules (Hardcoded Variables)
1.  **DSN Mapping:** Last 5 digits of the `Serial Number` column.
2.  **Bus Variant Identifiers:** Starts with `V83`, `F83`, `M83`, or `L83`.
3.  **LWC Description Overrides:** 5th character 'T' combined with '4X2'.
4.  **HWC Description Overrides:** 5th and 6th character 'CM', or first two numeric digits > 30.
5.  **Domestic Identifier:** Variant starting with `V`.

## 6. Execution & Deployment
The system is designed to run locally or via an internal network server. 
* **Command:** `python app.py`
* **Port:** Runs on `localhost:5050` with anti-caching headers implemented for rapid development iteration.
