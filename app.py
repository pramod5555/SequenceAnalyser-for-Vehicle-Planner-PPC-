from pathlib import Path

from flask import Flask, request, jsonify, send_file
import pandas as pd
import numpy as np
import io

app = Flask(__name__)
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIST_DIR = BASE_DIR / 'frontend' / 'dist'

# --- ANTI-CACHING BLOCK FOR DEVELOPMENT ---
@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, post-check=0, pre-check=0, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '-1'
    return response
# ------------------------------------------

def parse_excel(file_bytes):
    try:
        df = pd.read_excel(io.BytesIO(file_bytes), header=0)
    except Exception:
        df = pd.read_csv(io.BytesIO(file_bytes), header=0)
        
    df.columns = df.columns.astype(str).str.strip()
    return df

def analyze_sequence(df, shortages):
    if df.empty:
        return {
            'summary': { 
                'dsn_min': 0, 'dsn_max': 0, 'total_in_file': 0, 'total_hold': 0, 'total_skipped': 0, 
                'state_distribution': {}, 'hold_stratification': {}, 'skip_stratification': {}, 
                'hold_type_stratification': {}, 'skip_type_stratification': {}, 
                'hold_wc_stratification': {}, 'skip_wc_stratification': {},
                'hold_region_stratification': {}, 'skip_region_stratification': {},
                'shortage_parts': [] 
            },
            'hold_orders': [], 'skip_orders': [], 'gaps': [], 'preview_columns': [], 'preview_data': []
        }

    original_df = df.copy()

    # DYNAMIC COLUMN IDENTIFICATION
    dsn_col = next((c for c in original_df.columns if str(c).strip().upper() in ['DSN', 'DELIVERY SEQUENCE NUMBER']), None)
    if not dsn_col and len(original_df.columns) > 2:
        dsn_col = original_df.columns[2]

    serial_col = next((c for c in original_df.columns if str(c).strip().upper() == 'SERIAL NUMBER'), None)
    if not serial_col and len(original_df.columns) > 3:
        serial_col = original_df.columns[3]
        
    variant_col = next((c for c in original_df.columns if str(c).strip().upper() == 'VARIANT'), None)
    if not variant_col and len(original_df.columns) > 6:
        variant_col = original_df.columns[6]

    desc_col = next((c for c in original_df.columns if str(c).strip().upper() == 'DESCRIPTION'), None)
    if not desc_col and len(original_df.columns) > 7:
        desc_col = original_df.columns[7]
        
    status_col = next((c for c in original_df.columns if str(c).strip().upper() == 'STATUS'), None)
    if not status_col and len(original_df.columns) > 8:
        status_col = original_df.columns[8]
        
    state_col = next((c for c in original_df.columns if str(c).strip().upper() in ['VEHICLE ORDER STATE', 'STATE']), None)
    if not state_col and len(original_df.columns) > 9:
        state_col = original_df.columns[9]
        
    order_col = next((c for c in original_df.columns if str(c).strip().upper() in ['ORDER NUMBER', 'ORDER NO']), None)

    if not serial_col or not state_col:
        raise ValueError("Required columns (Column D, Column I, or Column J) could not be found in the uploaded file.")

    extra_cols = ['Order Number', 'Hold Status', 'Vehicle Start Time', 'Country']
    extra_cols = [c for c in extra_cols if c in original_df.columns]

    # =========================================================
    # LOGIC HELPERS: MODEL, WORK CONTENT, & REGION
    # =========================================================
    def extract_model(desc_val):
        desc_str = str(desc_val).strip()
        if not desc_str or desc_str.lower() == 'nan':
            return 'Unknown'
        if len(desc_str) >= 6 and desc_str[5] in ['T', 'S', 'M']:
            return desc_str[:6]
        elif len(desc_str) >= 5:
            return desc_str[:5]
        return desc_str

    def get_work_content(variant_val, desc_val):
        var_str = str(variant_val).strip().upper()
        if var_str.startswith(('V83', 'F83', 'M83', 'L83')):
            return 'HWC'
        desc_str = str(desc_val).strip().upper()
        if len(desc_str) >= 5 and desc_str[4] == 'T' and '4X2' in desc_str:
            return 'LWC'
        if len(desc_str) >= 6 and desc_str[4:6] == 'CM':
            return 'HWC'
        if len(desc_str) >= 2:
            first_two = desc_str[:2]
            if first_two.isdigit() and int(first_two) > 30:
                return 'HWC'
        return 'LWC'
        
    def get_region(variant_val):
        if str(variant_val).strip().upper().startswith('V'):
            return 'Domestic'
        return 'Export'

    # Insert Data Columns into original_df
    original_df['Model'] = original_df[desc_col].apply(extract_model)
    original_df['Work Content'] = original_df.apply(lambda row: get_work_content(row.get(variant_col, ''), row.get(desc_col, '')), axis=1)
    original_df['Region'] = original_df[variant_col].apply(get_region)
    
    cols = list(original_df.columns)
    cols.remove('Model')
    cols.remove('Work Content')
    cols.remove('Region')
        
    if desc_col in cols:
        desc_idx = cols.index(desc_col)
        cols.insert(desc_idx + 1, 'Model')
        cols.insert(desc_idx + 2, 'Work Content')
        cols.insert(desc_idx + 3, 'Region')
    else:
        cols.append('Model')
        cols.append('Work Content')
        cols.append('Region')
        
    original_df = original_df[cols]

    # =========================================================
    # PART SHORTAGE MAPPING LOGIC (WITH REF & QTY)
    # =========================================================
    cols = list(original_df.columns)
    insert_idx = len(cols)
    hold_status_col = next((c for c in cols if str(c).strip().upper() == 'HOLD STATUS'), None)
    if hold_status_col:
        insert_idx = cols.index(hold_status_col) + 1

    for part_num, details in shortages.items():
        var_set = details['variants']
        ref_order = details['ref_order']
        qty = details['qty']
        
        start_idx = 0
        if order_col and ref_order:
            matches = original_df.index[original_df[order_col].astype(str).str.strip() == ref_order].tolist()
            if matches:
                start_idx = matches[0]

        col_data = [''] * len(original_df)
        for i in range(len(original_df)):
            var = str(original_df.iloc[i].get(variant_col, '')).strip().upper()
            if var in var_set:
                if i < start_idx:
                    col_data[i] = 'Covered'
                else:
                    if qty > 0:
                        col_data[i] = 'Covered'
                        qty -= 1
                    else:
                        col_data[i] = '⚠️ SHORTAGE'
        
        original_df.insert(insert_idx, part_num, col_data)
        insert_idx += 1
        extra_cols.append(part_num)

    def build_record_dict(row, seq_val):
        d = {
            'seq_val': seq_val,
            'dsn': str(row.get(dsn_col, '')),
            'serial': str(row.get(serial_col, '')),
            'vehicle_order_state': str(row.get(state_col, '')),
            'status': str(row.get(status_col, '')) if status_col else '',
            'description': str(row.get(desc_col, '')) if desc_col else '',
            'model': str(row.get('Model', '')),
            'variant': str(row.get(variant_col, '')) if variant_col else '',
            'work_content': str(row.get('Work Content', '')),
            'region': str(row.get('Region', ''))
        }
        for c in extra_cols:
            val = row.get(c, '')
            d[c.lower().replace(' ', '_')] = '' if pd.isna(val) else str(val)
        return d

    # =========================================================
    # 1. HOLD LOGIC
    # =========================================================
    hold_mask = original_df[state_col].astype(str).str.strip().str.upper() == 'HOLD'
    hold_rows = original_df[hold_mask].copy()

    hold_records = []
    for _, r in hold_rows.iterrows():
        # Fallback seq_val for hold records
        raw_s = str(r.get(serial_col, '')).replace('.0', '').strip()
        seq_val = int(raw_s[-5:]) if len(raw_s) >= 5 and raw_s[-5:].isdigit() else 0
        hold_records.append(build_record_dict(r, seq_val))

    # =========================================================
    # 2. STRICT SEQUENCE SKIP LOGIC (Anomaly Block Tracking)
    # =========================================================
    df = original_df.copy()
    raw_serial = df[serial_col].astype(str).str.replace(r'\.0$', '', regex=True).str.strip()
    df['_seq_int'] = pd.to_numeric(raw_serial.str[-5:], errors='coerce')
    df = df.dropna(subset=['_seq_int'])
    df['_seq_int'] = df['_seq_int'].astype(int)

    gaps = []
    skip_records = []
    
    last_valid_seq = None
    is_in_anomaly_block = False
    current_anomaly_group = []
    anomaly_start_seq = None

    for _, row in df.iterrows():
        current_seq = int(row['_seq_int'])
        status_val = str(row.get(status_col, '')).strip().upper() if status_col else ''

        if last_valid_seq is None:
            last_valid_seq = current_seq
            continue

        expected_next = last_valid_seq + 1

        if current_seq == expected_next:
            last_valid_seq = current_seq
            
            if is_in_anomaly_block:
                first_anomaly = current_anomaly_group[0]['_seq_int']
                last_anomaly = current_anomaly_group[-1]['_seq_int']
                skipped_range = f"{first_anomaly} – {last_anomaly}" if first_anomaly != last_anomaly else str(first_anomaly)

                gaps.append({
                    'from_dsn': anomaly_start_seq,
                    'to_dsn': current_seq,
                    'skipped_count': len(current_anomaly_group),
                    'skipped_range': skipped_range
                })
                
                current_anomaly_group = []
                is_in_anomaly_block = False
        else:
            if is_in_anomaly_block:
                current_anomaly_group.append(row)
                if status_val == 'TRIM LINE':
                    skip_records.append(build_record_dict(row, current_seq))
            else:
                if status_val == 'TRIM LINE':
                    is_in_anomaly_block = True
                    anomaly_start_seq = last_valid_seq
                    current_anomaly_group.append(row)
                    skip_records.append(build_record_dict(row, current_seq))
                else:
                    last_valid_seq = current_seq

    if is_in_anomaly_block and current_anomaly_group:
        first_anomaly = current_anomaly_group[0]['_seq_int']
        last_anomaly = current_anomaly_group[-1]['_seq_int']
        skipped_range = f"{first_anomaly} – {last_anomaly}" if first_anomaly != last_anomaly else str(first_anomaly)
        gaps.append({
            'from_dsn': anomaly_start_seq,
            'to_dsn': 'End of File',
            'skipped_count': len(current_anomaly_group),
            'skipped_range': skipped_range
        })

    # =========================================================
    # 3. GENERATE STRATIFICATIONS
    # =========================================================
    hold_strat = {}
    hold_type_strat = {'Bus': 0, 'Truck': 0}
    hold_wc_strat = {'HWC': 0, 'LWC': 0}
    hold_region_strat = {'Domestic': 0, 'Export': 0}
    
    for r in hold_records:
        model = r.get('model', 'Unknown')
        hold_strat[model] = hold_strat.get(model, 0) + 1
        
        var_str = r.get('variant', '').strip().upper()
        if var_str.startswith(('V83', 'F83', 'M83', 'L83')):
            hold_type_strat['Bus'] += 1
            r['vehicle_type'] = 'Bus'
        else:
            hold_type_strat['Truck'] += 1
            r['vehicle_type'] = 'Truck'
            
        wc = r.get('work_content', 'LWC')
        hold_wc_strat[wc] = hold_wc_strat.get(wc, 0) + 1
        
        reg = r.get('region', 'Export')
        hold_region_strat[reg] = hold_region_strat.get(reg, 0) + 1
        
    skip_strat = {}
    skip_type_strat = {'Bus': 0, 'Truck': 0}
    skip_wc_strat = {'HWC': 0, 'LWC': 0}
    skip_region_strat = {'Domestic': 0, 'Export': 0}
    
    for r in skip_records:
        model = r.get('model', 'Unknown')
        skip_strat[model] = skip_strat.get(model, 0) + 1
        
        var_str = r.get('variant', '').strip().upper()
        if var_str.startswith(('V83', 'F83', 'M83', 'L83')):
            skip_type_strat['Bus'] += 1
            r['vehicle_type'] = 'Bus'
        else:
            skip_type_strat['Truck'] += 1
            r['vehicle_type'] = 'Truck'
            
        wc = r.get('work_content', 'LWC')
        skip_wc_strat[wc] = skip_wc_strat.get(wc, 0) + 1
        
        reg = r.get('region', 'Export')
        skip_region_strat[reg] = skip_region_strat.get(reg, 0) + 1

    # =========================================================
    # 4. PREPARE FINAL JSON RESPONSE
    # =========================================================
    total_rows = len(original_df)
    total_hold = len(hold_records)
    total_skipped = len(skip_records)
    
    valid_seqs = df['_seq_int']
    dsn_min = int(valid_seqs.min()) if not valid_seqs.empty else 0
    dsn_max = int(valid_seqs.max()) if not valid_seqs.empty else 0
    
    return {
        'summary': {
            'dsn_min': dsn_min,
            'dsn_max': dsn_max,
            'total_in_file': total_rows,
            'total_hold': total_hold,
            'total_skipped': total_skipped,
            'hold_stratification': hold_strat,
            'skip_stratification': skip_strat,
            'hold_type_stratification': hold_type_strat,
            'skip_type_stratification': skip_type_strat,
            'hold_wc_stratification': hold_wc_strat,
            'skip_wc_stratification': skip_wc_strat,
            'hold_region_stratification': hold_region_strat,
            'skip_region_stratification': skip_region_strat,
            'shortage_parts': list(shortages.keys())
        },
        'hold_orders': hold_records,
        'skip_orders': skip_records,
        'gaps': gaps,
        'preview_columns': [str(c) for c in original_df.columns.tolist()],
        'preview_data': original_df.fillna('').astype(str).replace('nan', '').to_dict(orient='records')
    }

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def index(path):
    requested_file = FRONTEND_DIST_DIR / path
    if path and requested_file.is_file():
        return send_file(requested_file)

    built_index = FRONTEND_DIST_DIR / 'index.html'
    if built_index.exists():
        return send_file(built_index)

    return send_file(BASE_DIR / 'index.html')

@app.route('/api/analyze', methods=['POST'])
def analyze():
    if 'file' not in request.files:
        return jsonify({'error': 'No main sequence file uploaded'}), 400
    
    f = request.files['file']
    if not f.filename.endswith(('.xlsx', '.xls', '.csv')):
        return jsonify({'error': 'Only .xlsx, .xls, and .csv files are supported'}), 400
        
    # Process Shortage Files & Inputs
    shortage_parts = request.form.getlist('shortage_parts')
    shortage_refs = request.form.getlist('shortage_refs')
    shortage_qtys = request.form.getlist('shortage_qtys')
    shortage_files = request.files.getlist('shortage_files')
    
    shortages = {}
    for i in range(min(len(shortage_parts), len(shortage_files))):
        part_num = shortage_parts[i].strip()
        ref_order = shortage_refs[i].strip() if i < len(shortage_refs) else ''
        try:
            qty = int(shortage_qtys[i].strip())
        except:
            qty = 0
            
        file_obj = shortage_files[i]
        
        if part_num and file_obj.filename:
            try:
                df_part = parse_excel(file_obj.read())
                # Ensure Column F (Index 5) exists for Variant extraction
                if len(df_part.columns) > 5:
                    variants = df_part.iloc[:, 5].astype(str).str.strip().str.upper().tolist()
                    shortages[part_num] = {
                        'variants': set(variants),
                        'ref_order': ref_order,
                        'qty': qty
                    }
            except Exception as e:
                print(f"Error parsing shortage file for {part_num}: {e}")

    try:
        df = parse_excel(f.read())
        result = analyze_sequence(df, shortages)
        return jsonify(result)
    except Exception as e:
        print(f"Server Error during analysis: {str(e)}")
        return jsonify({'error': f"Processing error: {str(e)}"}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5050)
