#!/usr/bin/env python3
"""
SustainaDev CO2 & Energy Estimation
Complete version with dynamic cost calculation
"""

from codecarbon import EmissionsTracker
import json
import sys

def estimate_energy_and_emissions(delta_ccn):
    """
    Estimates energy consumption and CO2 emissions based on complexity reduction.
    
    Args:
        delta_ccn: The reduction in Cyclomatic Complexity Number
        
    Returns:
        dict: Complete energy and emissions data
    """
    
    # Initialize emissions tracker (CodeCarbon)
    tracker = EmissionsTracker(
        save_to_file=False,
        logging_logger=None,
        log_level='error'
    )
    
    try:
        tracker.start()
        
        # Simulate computational workload
        for _ in range(2_000_000):
            pass
        
        emissions_kg = tracker.stop() or 0.0
        
    except Exception as e:
        print(json.dumps({"error": f"Tracker failed: {str(e)}"}), file=sys.stderr)
        emissions_kg = 0.0
    
    # ========================================
    # ENERGY ESTIMATION
    # ========================================
    
    # Energy saved per CCN point reduction
    # Adjusted for better visibility (10x from original 0.00001)
    kwh_per_ccn_point = 0.0001  # kWh per CCN point
    
    # Calculate total energy saved
    estimated_kwh_saved = max(delta_ccn * kwh_per_ccn_point, 0)
    
    # ========================================
    # COST CALCULATION (DYNAMIC BY REGION)
    # ========================================
    
    # Cost rates by region ($/kWh)
    COST_RATES = {
        'Egypt': 0.08,      # Egyptian Electricity Authority 2024
        'US': 0.15,         # US Energy Information Administration 2024
        'EU': 0.25,         # Eurostat 2024
        'UK': 0.35,         # Ofgem 2024
        'World': 0.15       # Global average (IEA 2024)
    }
    
    # Select region (default to World average)
    # You can change this to match your location
    region = 'World'  # Options: 'Egypt', 'US', 'EU', 'UK', 'World'
    cost_per_kwh = COST_RATES.get(region, 0.15)
    
    # Calculate cost savings in USD
    estimated_cost_saved_usd = estimated_kwh_saved * cost_per_kwh
    
    # ========================================
    # CO2 CALCULATIONS
    # ========================================
    
    # Global average CO2 emissions per kWh (IEA standard)
    co2_per_kwh = 0.475  # kg CO2 per kWh
    
    # Calculate CO2 saved from energy reduction
    estimated_co2_saved_kg = estimated_kwh_saved * co2_per_kwh
    
    # Total CO2 impact (measured + estimated)
    total_co2_impact = emissions_kg + estimated_co2_saved_kg
    
    # ========================================
    # ENVIRONMENTAL IMPACT EQUIVALENTS
    # ========================================
    
    # Trees needed to offset CO2 (1 tree absorbs ~21 kg CO2/year)
    trees_equivalent = estimated_co2_saved_kg / 21.0
    
    # Car miles not driven (average car: 0.4 kg CO2/mile)
    miles_not_driven = estimated_co2_saved_kg / 0.4
    
    # Smartphone charges (1 charge ≈ 0.008 kWh)
    smartphone_charges = estimated_kwh_saved / 0.008
    
    # 100W lightbulb hours (0.1 kWh per hour)
    lightbulb_hours = estimated_kwh_saved / 0.1
    
    # ========================================
    # RETURN COMPLETE DATA
    # ========================================
    
    result = {
        # Core metrics
        "emissions_kg": round(emissions_kg, 8),
        "estimated_kwh_saved": round(estimated_kwh_saved, 8),
        "estimated_co2_saved_kg": round(estimated_co2_saved_kg, 8),
        "total_co2_impact_kg": round(total_co2_impact, 8),
        "estimated_cost_saved_usd": round(estimated_cost_saved_usd, 8),
        
        # Input parameter
        "delta_ccn": delta_ccn,
        
        # Environmental equivalents
        "equivalents": {
            "trees_to_offset": round(trees_equivalent, 4),
            "miles_not_driven": round(miles_not_driven, 2),
            "smartphone_charges": round(smartphone_charges, 1),
            "lightbulb_hours_100w": round(lightbulb_hours, 2)
        },
        
        # Calculation metadata
        "metadata": {
            "cost_per_kwh_usd": cost_per_kwh,
            "cost_region": region,
            "co2_per_kwh_kg": co2_per_kwh,
            "kwh_per_ccn_point": kwh_per_ccn_point,
            "method": "CodeCarbon + CCN-based estimation",
            "note": "Values adjusted 10x for better visualization"
        }
    }
    
    return result


def main():
    """Main entry point for the script."""
    
    if len(sys.argv) > 1:
        try:
            delta_ccn = float(sys.argv[1])
        except ValueError:
            print(json.dumps({"error": "Invalid delta_ccn value. Must be a number."}))
            sys.exit(1)
    else:
        delta_ccn = 10.0  # Default value for testing
    
    result = estimate_energy_and_emissions(delta_ccn)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()